const fieldsUtil = require('../common/fieldsUtil');
const sqlModel = require('./sqlModel');
const kode4String = require('../util').kode4String;

module.exports = [
  {
    name: 'ændret',
    selectable: true
  },
  {
    name: 'geo_ændret',
    selectable: true
  },
  {
    name: 'geo_version',
    selectable: true
  },
  {
    name: 'geom_json'
  },
  {
    name: 'bbox_xmin'
  },
  {
    name: 'bbox_ymin'
  },
  {
    name: 'bbox_xmax'
  },
  {
    name: 'bbox_ymax'
  },
  {
    name: 'visueltcenter_x'
  },
  {
    name: 'visueltcenter_y'
  },
  {
    name: 'ejerlavkode'
  }, {
    name: 'matrikelnr'
  }, {
    name: 'kommunekode',
    formatter: kode4String
  },
  { name: 'kommunenavn'}
  , {
    name: 'sognekode',
    formatter: kode4String
  },
  { name: 'sognenavn'}
  , {
    name: 'regionskode',
    formatter: kode4String
  },
  { name: 'regionsnavn'},
  {
    name: 'retskredskode',
    formatter: kode4String
  },
  { name: 'retskredsnavn'},
  {
    name: 'udvidet_esrejendomsnr'
  }, {
    name: 'esrejendomsnr'
  }, {
    name: 'sfeejendomsnr'
  },
  {
    name: 'ejerlavnavn'
  }
];

fieldsUtil.applySelectability(module.exports, sqlModel);
fieldsUtil.normalize(module.exports);