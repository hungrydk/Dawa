const { assert } =require('chai');
const child_process = require('child_process');
const fs = require('fs');
const path = require('path');
const split2 = require('split2');
const _ = require('underscore');
const Promise = require('bluebird');
const {go} = require('ts-csp');
const rawXmlStream = require('./rawXmlStreamExpat');
const logger = require('@dawadk/common/src/logger').forCategory('oisImport');
const zlib = require('zlib');
const createUnzipperProcess = (filePath, filePattern) => {
  const args = ['e', '-so', path.resolve(filePath), filePattern];
  const proc = child_process.spawn('7za', args);
  return proc;
}

const createOisStream = (dataDir, fileName, oisTable, format) => go(function* () {
  const filePath = path.join(dataDir, fileName);
  if(format === 'ndjson') {
    const inputStream = fs.createReadStream(filePath);
    const unzipper = zlib.createGunzip({});
    const splitter = split2('\n', line => {
      try {
        return JSON.parse(line);
      }
      catch(e) {
        logger.error(`Error streaming OIS file: ${e.message}`, e);
        throw e;
      }
    }, {});
    for(let stream of [inputStream, unzipper, splitter]) {
      stream.on('error', e => logger.error(`Error streaming OIS file: ${e.message}`, e));
    }
    inputStream.pipe(unzipper).pipe(splitter);
    return yield Promise.resolve(splitter);
  }
  else if(format === 'xml') {
    const xmlFileName = (fileName.substring(0, fileName.length - 4) + '.XML').toUpperCase();
    const unzipperProc = createUnzipperProcess(filePath, xmlFileName);
    const xmlStream = rawXmlStream(unzipperProc.stdout);
    return yield Promise.resolve(xmlStream);
  }
  else {
    assert(false);
  }
});

const getOisFileRegex = registerName =>
  new RegExp(`^ois_${registerName}_(co\\d+t)_(na|da|te)000_(\\d+)_(\\d+)_(\\d+).(zip|gz)$`, 'i');

const fileNameToDescriptor = (registerName, fileName) => {
  const match = getOisFileRegex(registerName).exec(fileName);
  if (!match) {
    throw new Error(`Filename ${fileName} did not match regex`);
  }
  const oisTable = match[1].toLowerCase();
  const total = match[2].toLowerCase() !== 'da';
  const serial = parseInt(match[3], 10);
  return {
    oisTable: oisTable,
    total: total,
    serial: serial,
    fileName: fileName,
    fileDate: match[4],
    fileTime: match[5],
    format: match[6].toLowerCase() === 'zip' ? 'xml' : 'ndjson'
  };
};

const getLastImportedSerial = (client, oisTable) => go(function* () {
  const alreadyImportedSerialsSql = `SELECT max(serial) as serial
                                     FROM ois_importlog
                                     WHERE oistable = $1`;
  return (yield client.queryRows(alreadyImportedSerialsSql, [oisTable.toLowerCase()]))[0].serial;
});

const registerOisImport = (client, oisTable, serial, total) =>
  client.query('INSERT INTO ois_importlog(oistable, serial, total, ts) VALUES ($1, $2, $3, NOW())',
    [oisTable.toLowerCase(), serial, total]);


const findFilesToImportForEntity = (client, oisRegister, oisTable, dataDir) => go(function* () {
  const filesAndDirectories = yield Promise.promisify(fs.readdir)(dataDir);
  const files = [];
  for (let fileOrDirectory of filesAndDirectories) {
    const stat = yield Promise.promisify(fs.stat)(path.join(dataDir, fileOrDirectory));
    if (!stat.isDirectory()) {
      files.push(fileOrDirectory);
    }
  }
  const oisFileRegex = getOisFileRegex(oisRegister);
  const oisFiles = files.filter(file => oisFileRegex.test(file));
  const descriptors = oisFiles.map(file => fileNameToDescriptor(oisRegister, file));
  const descriptorsForEntity = descriptors.filter(descriptor => descriptor.oisTable.toLowerCase() === oisTable.toLowerCase());
  if (descriptorsForEntity.length === 0) {
    return [];
  }
  const serialToFileMap = _.groupBy(descriptorsForEntity, 'serial');
  for (let serialStr of Object.keys(serialToFileMap)) {
    if (serialToFileMap[serialStr].length > 1) {
      logger.error('Duplicate Serial', {
        serial: serialStr,
        files: serialToFileMap[serialStr]
      });
      throw new Error('Duplicate serial');
    }
  }
  const serials = Object.keys(serialToFileMap).map(serial => parseInt(serial, 10));
  const lastImportedSerial = yield getLastImportedSerial(client, oisTable);
  const lastTotalSerial = _.max(descriptors.filter(descriptor => descriptor.total).map(descriptor => descriptor.serial));
  const firstSerialToImport = Math.max(lastImportedSerial + 1, lastTotalSerial);
  const serialsToImport = serials.filter(serial => serial >= firstSerialToImport);
  serialsToImport.sort((a, b) => a - b);
  if (serialsToImport.length === 0) {
    return [];
  }
  const firstImportedSerial = serialsToImport[0];
  if (firstImportedSerial !== firstSerialToImport) {
    logger.error('Missing serial', {
      oisTable,
      serial: lastImportedSerial + 1
    });
    throw new Error('Missing serial');
  }
  for (let i = 0; i < serialsToImport.length - 2; ++i) {
    if (serialsToImport[i] + 1 !== serialsToImport[i + 1]) {
      logger.error('Missing serial', {
        oisTable,
        serial: serialsToImport[i] + 1
      });
      throw new Error('Missing serial');
    }
  }
  return serialsToImport.map(serial => serialToFileMap[serial][0]);
});


module.exports = {
  createUnzipperProcess,
  getOisFileRegex,
  fileNameToDescriptor,
  getLastImportedSerial,
  createOisStream,
  findFilesToImportForEntity,
  registerOisImport
};