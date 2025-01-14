"use strict";

var express = require('express');
var fs = require('fs');
const path  = require('path');
var parameterDoc = require('./parameterDoc');
var paths = require('./apiSpecification/paths');
var docUtil = require('./docUtil');
var registry = require('./apiSpecification/registry');
var _ = require('underscore');
var schemaUtil = require('./apiSpecification/schemaUtil');
const replikeringModels = require('./apiSpecification/replikering/datamodel');
const { schemas: replikeringSchemas } = require('./apiSpecification/replikering/normalizedFieldSchemas');
const replikeringBindings = require('./apiSpecification/replikering/dbBindings');
const replikeringDataSections = require('./apidoc/replikering-data-page');
const {cachingMiddleware} = require('./middleware/caching');
const config = require('@dawadk/common/src/config/holder').getConfig();
require('./apiSpecification/allSpecs');
const allPages = require('./apidoc/all-pages');
const { openApiJson } = require('./openapi');

/*jslint stupid: true */
/*stupid:true makes JSLint allow use of .readFileSync */
var packageJson = JSON.parse(fs.readFileSync(__dirname + '/package.json'));
/*jslint stupid: false */

var app = express();
app.set('views', __dirname + '/views');
app.set('view engine', 'pug');
app.use(cachingMiddleware);

var jsonSchemas = _.reduce(registry.entriesWhere({
  type: 'representation',
  qualifier: 'json'
}), function (memo, entry) {
  if (entry.object.schema) {
    memo[entry.entityName] = schemaUtil.compileSchema(entry.object.schema);
  }
  return memo;
}, {});

var autocompleteSchemas = _.reduce(registry.entriesWhere({
  type: 'representation',
  qualifier: 'autocomplete'
}), function (memo, entry) {
  memo[entry.entityName] = schemaUtil.compileSchema(entry.object.schema);
  return memo;
}, {});



function pugDocumentationParams(req) {
  const url = config.get('service_url') ? config.get('service_url') : paths.baseUrl(req);
  return {
    url,
    path: req.path,
    jsonSchemas,
    autocompleteSchemas,
    parameterDoc,
    docUtil,
    packageJson,
    replikeringModels,
    replikeringSchemas,
    replikeringDataSections,
    replikeringBindings
  };
}

const shouldRedirectToHttps = req => {
  const host = req.headers.host;
  if(_.isString(host) && host.indexOf('aws.dk') !== -1) {
    return  config.get('redirect_insecure') && paths.getProtocol(req) !== 'https';
  }
  else {
    return false;
  }
};

const getRedirectUrl = req => {
  const secureBaseUrl = paths.baseUrl(req).replace('http:', 'https:');
  return `${secureBaseUrl}${req.url}`;
};

function setupPugPage(path, page) {
  app.get(path, function (req, res) {
    if(shouldRedirectToHttps(req)) {
      res.redirect(getRedirectUrl(req));
    }
    else {
      res.render(page, pugDocumentationParams(req));
    }
  });
}

const setupApidocDetails = (page ) => {
  const path = `/dok/api/${encodeURIComponent(page.entity)}`;
  app.get(path, function (req, res) {
    res.render('apidoc-detaljer', Object.assign(pugDocumentationParams(req), {page}));
  });
};

function setupLegacySchemaPage(uriPath) {
  app.get(uriPath, function (req, res) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.sendFile(path.resolve(__dirname, 'apidoc/schema.json'));
  });
}

app.get('/openapi.json', (req, res) => {
  res.json(openApiJson);
});

for(let område of ['adresser', 'dagi', 'bbr', 'matrikelkortet', 'stednavne']) {
  setupPugPage(`/dok/${område}`, `omraader/${område}.pug`);

}
setupPugPage('/dok/api/replikering-data', 'replikering-data.pug');
setupPugPage('/', 'forside.pug');
setupPugPage('/dok/om', 'om.pug');
setupPugPage('/dok/api', 'apidoc-oversigt.pug');
setupPugPage('/dok/api/generelt', 'generelt.pug');
setupPugPage('/dok/guides', 'guides.pug');
setupPugPage('/dok/release-noter', 'release-noter.pug');
setupPugPage('/dok/bbr-intern', 'bbr-intern.pug');
for(let guide of ['introduktion', 'autocomplete', 'datavask', 'replikering', 'autocomplete-old', 'replikering-old', 'replikeringsklient']) {
  setupPugPage(`/dok/guide/${guide}`, `guide/${guide}.pug`);
}
setupPugPage('/dok/faq', 'faq.pug');

for(let page of allPages) {
  setupApidocDetails(page);
}

setupLegacySchemaPage('/replikeringdok/schema.json');

const redirects = [
  ['/autocompletedok', '/dok/guide/autocomplete'],
  ['/generelt', '/dok/api/generelt'],
  ['/adressedok', '/dok/api/adresse'],
  ['/adgangsadressedok', '/dok/api/adgangsadresse'],
  ['/vejedok', '/dok/api/vejstykke'],
  ['/postnummerdok', '/dok/api/postnummer'],
  ['/om', '/dok/om'],
  ['/listerdok', '/dok/api'],
  ['/bbrlightdok', '/dok/bbr'],
  ['/replikeringdok', '/dok/guide/replikering'],
  ['/oisdok', '/dok/bbr-intern']
];

for(let [oldPath, newPath] of redirects) {
  app.get(oldPath, function (req, res) {
    res.redirect(newPath);
  });

}

module.exports = app;
module.exports.internal = {
  shouldRedirectToHttps,
  getRedirectUrl
};
