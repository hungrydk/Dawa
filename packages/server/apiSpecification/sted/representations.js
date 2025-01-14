"use strict";

"use strict";

const _ = require('underscore');

const representationUtil = require('../common/representationUtil');
const fields = require('./fields');
const registry = require('../registry');
const {globalSchemaObject} = require('../commonSchemaDefinitionsUtil');
const {nullableType, schemaObject} = require('../schemaUtil');
const { mapKommuneRefArray, makeHref, mapBbox } = require('../commonMappers');

const fieldsExcludedFromFlat = ['geom_json', 'visueltcenter'];
const flatFields = representationUtil.fieldsWithoutNames(fields, fieldsExcludedFromFlat);

var schema = require('../parameterSchema');

exports.flat = representationUtil.defaultFlatRepresentation(flatFields);

const fieldsExcludedFromJson = ['geom_json', 'visueltcenter'];

exports.json = {
  schema: globalSchemaObject({
    title: 'Sted',
    properties: {
      id: {
        type: 'string',
        schema: schema.uuid,
        description: 'Stedets unikke ID'
      },
      href: {
        type: 'string',
        description: 'Stedets unikke URL'
      },
      primærtnavn: {
        type: nullableType('string'),
        description: 'Stedets primære navn'
      },
      primærnavnestatus: {
        enum: ['officielt', 'uofficielt', 'suAutoriseret'],
        description: 'Stedets primære navns status. Mulige værdier: "officielt", "uofficielt", "suAutoriseret"',
      },
      sekundærenavne: {
        type: 'array',
        description: 'Stedets sekundære navne',
        items: schemaObject({
          properties: {
            navn: {
              type: 'string',
              description: 'Det sekundære navn'
            },
            navnestatus: {
              enum: ['officielt', 'uofficielt', 'suAutoriseret'],
              description: 'Det sekundære navns status'
            }
          },
          docOrder: ['navn', 'navnestatus']
        })
      },
      hovedtype: {
        type: 'string',
        description: 'Stedets hovedtype, eksempelvis Bebyggelse'
      },
      undertype: {
        type: 'string',
        description: 'Stedets undertype, eksempelvis bydel'
      },
      egenskaber: {
        description: 'Yderligere egenskaber for stedet, som er specifikke for den pågældende hovedtype'
      },
      bbox: {
        description: `Geometriens bounding box, dvs. det mindste rectangel som indeholder geometrien. Består af et array af 4 tal.
        De første to tal er koordinaterne for bounding boxens sydvestlige hjørne, og to sidste tal er
        koordinaterne for bounding boxens nordøstlige hjørne. Anvend srid parameteren til at angive det ønskede koordinatsystem.`,
        $ref: '#/definitions/NullableBbox'
      },
      visueltcenter: {
        description: 'Koordinater for stedets visuelle center. Kan eksempelvis benyttes til at placere stedets navn på et kort.',
        $ref: '#/definitions/NullableVisueltCenter'
      },
      'kommuner': {
        description: 'De kommuner hvis areal overlapper stedets areal.',
        type: 'array',
        items: {
          '$ref': '#/definitions/KommuneRef'
        }
      },
      'ændret': {
        description: 'Tidspunkt for seneste ændring registreret i DAWA. Opdateres ikke hvis ændringen kun vedrører' +
        ' geometrien (se felterne geo_ændret og geo_version).',
        $ref: '#/definitions/DateTimeUtc'
      },
      'geo_ændret': {
        description: 'Tidspunkt for seneste ændring af geometrien registreret i DAWA.',
        $ref: '#/definitions/DateTimeUtc'
      },
      geo_version: {
        description: 'Versionsangivelse for geometrien. Inkrementeres hver gang geometrien ændrer sig i DAWA.',
        type: 'integer'
      }

    },
    docOrder: ['id', 'href', 'primærtnavn', 'primærnavnestatus', 'sekundærenavne','hovedtype', 'undertype', 'egenskaber', 'bbox', 'visueltcenter', 'kommuner',
      'ændret', 'geo_ændret', 'geo_version']
  }),
  fields: _.filter(_.where(fields, {selectable: true}), function (field) {
    return !_.contains(fieldsExcludedFromJson, field.name);
  }),
  mapper: (baseUrl) => row => {
    const result = ['id', 'hovedtype', 'undertype', 'primærtnavn', 'primærnavnestatus', 'ændret', 'geo_ændret', 'geo_version'].reduce(
      (memo, prop) => {
        memo[prop] = row[prop];
        return memo;
      }, {});
    result.href = makeHref(baseUrl, 'sted', [row.id]);
    result.egenskaber = {};
    if(result.hovedtype === 'Bebyggelse') {
      result.egenskaber.bebyggelseskode = row.bebyggelseskode;
      result.egenskaber.indbyggerantal = row.indbyggerantal;
    }

    result.visueltcenter = row.visueltcenter_x ? [row.visueltcenter_x, row.visueltcenter_y] : null;
    result.bbox = mapBbox(row);
    result.kommuner = row.kommuner ? mapKommuneRefArray(row.kommuner,baseUrl) : [];
    result.sekundærenavne = row.sekundærenavne ? row.sekundærenavne : [];
    if(result.undertype === 'ø') {
      result.egenskaber.brofast = row.brofast;
    }
    return result;
  }
};

const geojsonField = _.findWhere(fields, {name: 'geom_json'});
representationUtil.addGeojsonRepresentations(exports, geojsonField);

registry.addMultiple('sted', 'representation', module.exports);
