const _ = require('underscore');
const {go, Channel, parallel} = require('ts-csp');
const {comp, map} = require('transducers-js');

const {copyStream} = require('@dawadk/import-util/src/postgres-streaming');
const cspUtil = require('@dawadk/common/src/csp-util');
const defaultBindings = require('./default-bindings');
const {csvStringify} = require('@dawadk/common/src/csv-stringify');
const tableDiff = require('@dawadk/import-util/src/table-diff');
const { computeDifferences } = require('./table-diff');
/**
 * Create a process which streams CSV from ch to the specified table
 */
const chanToDb = (client, ch, table, columnNames, batchSize) => {
  const stream = copyStream(client, table, columnNames);
  return cspUtil.pipeToStream(ch, stream, batchSize);
};

const createTempChangeTable = (client, replication_schema, bindingConf, tableName) =>
  client.query(`CREATE TEMP TABLE ${tableName} AS (select null::integer as txid, 
  null::${replication_schema}.operation_type as operation, 
  ${bindingConf.table}.* from ${bindingConf.table} where false)`);


const createMapper = (replikeringModel, entityConf, bindingConf) => obj => {
  const result = entityConf.attributes.reduce((acc, attrName) => {
    const replikeringAttrModel = _.findWhere(replikeringModel.attributes, {name: attrName});
    const binding =Object.assign({}, defaultBindings[replikeringAttrModel.type], bindingConf.attributes[attrName]);
    acc[binding.columnName] = binding.toCsv ? binding.toCsv(obj[attrName]) : obj[attrName];
    return acc;
  }, {});
  return result;
};

const copyToTable = (client, src, xform, table, columnNames, batchSize) => {
  const csvOptions = {
    delimiter: ';',
    quote: '"',
    escape: '\\',
    header: true,
    encoding: 'utf8',
    formatters: {
      bool: value => value ? 'true' : 'false'
    },
    columns: columnNames
  };
  const csvStringifyXf = csvStringify(csvOptions);
  const dbCh = new Channel(0, comp(xform, csvStringifyXf));
  const dbProcess = chanToDb(client, dbCh, table, columnNames, batchSize);
  const pipeProcess = cspUtil.pipe(src, dbCh, batchSize);
  return parallel(dbProcess, pipeProcess);
};

const createEventMapper = (txid, replikeringModel, entityConf, bindingConf) => {
  const mapDataFn = createMapper(replikeringModel, entityConf, bindingConf);
  return event => {
    const result = Object.assign(mapDataFn(event.data), {
      txid: event.txid,
      operation: event.operation
    });
    return result;
  }
};

const toTableModel = (replikeringModel, entityConf, bindingConf) => {
  return {
    table: bindingConf.table,
    primaryKey: replikeringModel.key,
    columns: entityConf.attributes.map(attrName => {
      const replikeringAttrModel = _.findWhere(replikeringModel.attributes, {name: attrName});
      const defaultBinding = defaultBindings[replikeringAttrModel.type];
      const attrBinding = Object.assign({}, defaultBinding, bindingConf.attributes[attrName]);
      const column = {name: attrBinding.columnName};
      if (defaultBinding.distinctClause) {
        column.distinctClause = defaultBinding.distinctClause;
      }
      return column;
    })
  };
};

const downloadEntity = (client, remoteTxid, replicationModel, entityConf, bindingConf, batchSize, httpClientImpl, targetTable) => go(function*() {
  const downloadCh = new Channel(0);
  // Produces a stream of parsed records to udtraekCh
  const requestProcess = httpClientImpl.downloadStream(entityConf.name, remoteTxid, downloadCh);
  const columnNames = _.pluck(bindingConf.attributes, 'columnName');
  const copyProcess = copyToTable(client, downloadCh, map(createMapper(replicationModel, entityConf, bindingConf)),
    targetTable, columnNames, batchSize);
  yield parallel(requestProcess, copyProcess);
});

const initializeEntity = (client, remoteTxid, localTxid, replicationModel, replicationSchema,
                          entityConf, bindingConf, batchSize, httpClientImpl) => go(function* () {

   yield downloadEntity(client, remoteTxid, replicationModel, entityConf, bindingConf, batchSize, httpClientImpl, bindingConf.table);
  yield client.query(`INSERT INTO ${replicationSchema}.source_transactions(source_txid,local_txid, entity, type)
    VALUES ($1,$2,$3,$4)`, [remoteTxid, localTxid, entityConf.name, 'download']);
});

const initialize = (client, remoteTxId, localTxid, replikeringModels, replikeringConfig, httpClientImpl) => go(function* () {
  for (let entityConf of replikeringConfig.entities) {
    const bindingConf = replikeringConfig.bindings[entityConf.name];
    yield initializeEntity(client, remoteTxId, localTxid, replikeringModels[entityConf.name], replikeringConfig.replication_schema,
      entityConf, bindingConf, 200, httpClientImpl);
  }
});

const updateEntity = (client, remoteTxid, localTxid, replicationModel, replicationSchema,
                      entityConf, bindingConf, batchSize, httpClientImpl) => go(function* () {
  const lastRemoteTxid = (yield client.queryRows(`select max(source_txid) as txid from ${replicationSchema}.source_transactions where entity=$1`, [entityConf.name]))[0].txid;
  const eventCh = new Channel(0);
  const tmpEventTableName = `tmp_${bindingConf.table}_changes`;
  yield createTempChangeTable(client, replicationSchema, bindingConf, tmpEventTableName);
  // Produces a stream of parsed records to udtraekCh
  const requestProcess = httpClientImpl.eventStream(entityConf.name, lastRemoteTxid + 1, remoteTxid, eventCh);
  const columnNames = _.pluck(bindingConf.attributes, "columnName");
  const copyProcess = copyToTable(client, eventCh, map(createEventMapper(localTxid, replicationModel, entityConf, bindingConf)),
    tmpEventTableName, ['txid', 'operation', ...columnNames], batchSize);
  yield parallel(requestProcess, copyProcess);
  const count = (yield client.queryRows(`select count(*)::integer as cnt from ${tmpEventTableName}`))[0].cnt;
  if(count === 0) {
    return;
  }
  // remove any operation that has been replaced by a new operation in the same local transaction
  yield client.query(`
WITH row_numbered AS (
    SELECT *, 
           ROW_NUMBER() OVER(PARTITION BY t.id 
                                 ORDER BY t.txid DESC) AS rk
      FROM ${tmpEventTableName} t),
      last_operation AS(
SELECT operation, ${columnNames.join(',')}
  FROM row_numbered t
 WHERE t.rk = 1)
 INSERT INTO ${bindingConf.table}_changes(txid, operation, ${columnNames.join(',')})
 (select $1, operation, ${columnNames.join(',')} from last_operation)`, [localTxid]);

  yield client.query(`drop table ${tmpEventTableName}`);
  // we treat updates as  inserts if the object doesn't exist.
  yield client.query(`update ${bindingConf.table}_changes  c set operation = 'insert'
  WHERE c.txid = $1 and c.operation = 'update' and not exists(select * from ${bindingConf.table} t where  t.id = c.id)`, [localTxid]);

  // we treat inserts as updates if the object exist.
  yield client.query(`update ${bindingConf.table}_changes  c set operation = 'update'
  WHERE c.txid = $1 and c.operation = 'insert' and exists(select * from ${bindingConf.table} t where  t.id = c.id)`, [localTxid]);

  // we ignore deletes on nonexisting objects
  yield client.query(`delete from ${bindingConf.table}_changes c
  WHERE c.txid = $1 and c.operation = 'delete' and 
  not exists(select * from ${bindingConf.table} t where  t.id = c.id)`, [localTxid]);

  // apply changes
  yield tableDiff.applyChanges(client, localTxid, toTableModel(replicationModel, entityConf, bindingConf));

  // record new remote txid
  yield client.query(`INSERT INTO ${replicationSchema}.source_transactions(source_txid,local_txid, entity, type)
    VALUES ($1,$2,$3,$4)`, [remoteTxid, localTxid, entityConf.name, 'event']);
});

const updateIncrementally = (client, localTxid, replicationModels, replicationConfig, httpClientImpl) => go(function* () {
  console.dir(replicationConfig);
  for (let entityConf of replicationConfig.entities) {
    const lastTransaction = yield httpClientImpl.lastTransaction();
    const bindingConf = replicationConfig.bindings[entityConf.name];
    yield updateEntity(client, lastTransaction.txid, localTxid, replicationModels[entityConf.name],
      replicationConfig.replication_schema, entityConf, bindingConf, 200, httpClientImpl);
  }
});

const updateEntityUsingDownload = (client, remoteTxid, localTxid, replicationModel, replicationSchema,
                          entityConf, bindingConf, batchSize, httpClientImpl) => go(function* () {

  const tmpTableName = `download_${bindingConf.table}`;
  yield client.query(`CREATE TEMP TABLE ${tmpTableName} (LIKE ${bindingConf.table})`);
  yield downloadEntity(client, remoteTxid, replicationModel, entityConf, bindingConf, batchSize, httpClientImpl, tmpTableName);
  const tableModel = toTableModel(replicationModel, entityConf, bindingConf);
  yield computeDifferences(client, localTxid, tmpTableName, tableModel);
  // apply changes
  yield tableDiff.applyChanges(client, localTxid, tableModel);

  yield client.query(`INSERT INTO ${replicationSchema}.source_transactions(source_txid,local_txid, entity, type)
    VALUES ($1,$2,$3,$4)`, [remoteTxid, localTxid, entityConf.name, 'download']);
});

const updateUsingDownload = (client, remoteTxId, localTxid, replicationModels, replicationConfig, httpClientImpl)=> go(function*() {
  for (let entityConf of replicationConfig.entities) {
    const bindingConf = replicationConfig.bindings[entityConf.name];
    yield updateEntityUsingDownload(client, remoteTxId, localTxid, replicationModels[entityConf.name], replicationConfig.replication_schema,
      entityConf, bindingConf, 200, httpClientImpl);
  }

});

module.exports = {
  initializeEntity,
  initialize,
  updateIncrementally,
  updateUsingDownload
};