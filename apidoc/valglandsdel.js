const {
  autocompleteSubtext,
  formatAndPagingParams,
  formatParameters,
  overwriteWithAutocompleteQParameter
} = require('./common');
const {
  dagiNavnParameter,
  dagiQParameter,
  dagiReplikeringTilknytningDoc,
  dagiReverseDoc,
  dagiReverseParameters,
  dagiSridCirkelPolygonParameters,
  getTemaDef
} = require('./dagiCommon');

const temaDef = getTemaDef('valglandsdel');
const bogstavParameter = {
  name: 'bogstav',
  doc: 'Valglandsdelens bogstav.'
};

const valglandsdelParameters = [
  bogstavParameter,
  dagiNavnParameter(temaDef),
  dagiQParameter(),
  ...dagiSridCirkelPolygonParameters(temaDef.plural)
];

const examples = {
  query: [{
    description: 'Find alle valglandsdele som starter med Midt',
    query: [{
      name: 'q',
      value: 'Midt*'
    }]
  }, {
    description: 'Returner alle valglandsdele',
    query: {}
  }],
  get: [{
    description: 'Returner oplysninger om valglandsdel Hovedstaden',
    path: ['/valglandsdele/A']
  }, {
    description: 'Returnerer oplysninger om valglandsdel Hovedstaden i GeoJSON format',
    path: ['/valglandsdele/A'],
    query: [{
      name: 'format',
      value: 'geojson'
    }]
  }],
  autocomplete: [{
    description: 'Find oplysninger om alle valglandsdele der starter med Midt',
    query: [{
      name: 'q',
      value: 'Midt'
    }]
  }]
};

module.exports = [
  {
    entity: 'valglandsdel',
    path: '/valglandsdele',
    subtext: 'Søg efter valglandsdele. Returnerer de valglandsdele der opfylder kriteriet.',
    parameters: [
      ...valglandsdelParameters,
      ...dagiReverseParameters(temaDef),
      ...formatAndPagingParams
    ],
    examples: examples.query
  },
  {
    entity: 'valglandsdel',
    path: '/valglandsdele/{bogstav}',
    subtext: 'Modtag valglandsdel ud fra bogstav.',
    parameters: [bogstavParameter,
      ...formatParameters],
    nomulti: true,
    examples: examples.get
  },
  {
    entity: 'valglandsdel',
    path: '/valglandsdele/autocomplete',
    subtext: autocompleteSubtext(temaDef.plural),
    parameters: [
      ...overwriteWithAutocompleteQParameter(valglandsdelParameters),
      ...formatAndPagingParams
    ],
    examples: examples.autocomplete
  },
  dagiReverseDoc(temaDef),
  ...dagiReplikeringTilknytningDoc(temaDef)
];