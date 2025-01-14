"use strict";

// This file contains an implementation of the varius SQL WHERE and ORDER clauses that needs
// to be generated based on input parameters.

var _ = require('underscore');

const dbapi = require('../../../dbapi');
const sqlUtil = require('./sqlUtil');
const util = require('../../util');

var notNull = util.notNull;

function removeSpecialSearchChars(q) {
    return q.replace(/[^a-zA-Z0-9æÆøØåÅäÄèÈéÉëËüÜöÖóÓÿŸ\*]/g, ' ');
}

function toPgSearchQuery(q) {
    // remove all special chars
    q = removeSpecialSearchChars(q);

    // collapse sequences of * into a single *
    q = q.replace(/\*+/g, '*');

    // replace '*' not at the end of a token with ' '
    q = q.replace(/[\*]([^ ])/g, ' $1');

    // remove any tokens consisting only of '*'
    q = q.replace(/(^|[ ])[\*]/g, ' ');

    // normalize whitespace
    q = q.replace(/\s+/g, ' ');

    // remove leading / trailing whitespace
    q = q.replace(/^\s*/g, '');
    q = q.replace(/\s*$/g, '');

    // tokenize the query
    var tokens = q.split(' ');

    tokens = _.map(tokens, function (token) {
        if (endsWith(token, '*')) {
            token = token.substring(0, token.length - 1) + ':*';
        }
        return token;
    });

    return tokens.join(' & ');
}

function endsWith(str, suffix) {
    return str.indexOf(suffix, str.length - suffix.length) !== -1;
}

function toPgSuggestQuery(q) {
    // remove all special chars
    q = removeSpecialSearchChars(q);

    // normalize whitespace
    q = q.replace(/\s+/g, ' ');

    var hasTrailingWhitespace = /.*\s$/.test(q);
    var tsq = toPgSearchQuery(q);

    // Since we do suggest, if there is no trailing whitespace,
    // the last search clause should be a prefix search
    if (!hasTrailingWhitespace && !endsWith(tsq, '*') && tsq.length > 0) {
        tsq += ":*";
    }
    return tsq;
}

function queryForRanking(tsq) {
    return tsq.replace(/ & /g, ' | ');
}

function getSearchColumn(columnSpec) {
    return sqlUtil.getColumnNameForWhere(columnSpec, 'tsv');
}

function searchWhereClause(paramAlias, columnSpec) {
    var columnName = getSearchColumn(columnSpec);
    return "(" + columnName + " @@ to_tsquery('adresser_query', " + paramAlias + "))";
}

const sqlRankExpr = (queryParamAlias, vectorExpr) =>
    `round(1000000 * ts_rank(${vectorExpr}, to_tsquery('adresser_query',${queryParamAlias}), 16))`;

function searchOrderClause(paramAlias) {
    var vectorExpr = 'tsv';
    return `${sqlRankExpr(paramAlias, vectorExpr)} DESC`;
}

exports.searchOrderClause = searchOrderClause;

module.exports.husnrInterval = function () {
    return function (sqlParts, params) {
        if (params.husnrfra) {
            let paramAlias = dbapi.addSqlParameter(sqlParts, params.husnrfra);
            sqlParts.whereClauses.push(`husnr >= ${paramAlias}::husnr`);
        }
        if (params.husnrtil) {
            let paramAlias = dbapi.addSqlParameter(sqlParts, params.husnrtil);
            sqlParts.whereClauses.push(`husnr <= ${paramAlias}::husnr`);
        }
    }
};


/*
 * Adds a simple equality where clause. Supports multi parameters.
 */
exports.simplePropertyFilter = function (parameterSpec, columnSpec) {
    return function (sqlParts, params) {
        parameterSpec.forEach(function (parameter) {
            var name = parameter.renameTo || parameter.name;
            var param = params[name];
            if (param !== undefined) {
                var whereSpec = sqlUtil.getColumnNameForWhere(columnSpec, name);
                if (_.isFunction(whereSpec)) {
                    whereSpec(sqlParts, param, params);
                } else {
                    var column = whereSpec;
                    var paramValues = param === null ? [null] : (param._multi_ ? param.values : [param]);
                    var orClauses = _.map(paramValues,
                        function (value) {
                            if (value !== null) {
                                var parameterAlias = dbapi.addSqlParameter(sqlParts, value);
                                return (column + " = " + parameterAlias);
                            } else {
                                return (column + ' IS NULL');
                            }
                        });
                    sqlParts.whereClauses.push("(" + orClauses.join(" OR ") + ")");
                    if(parameter.orderBy) {
                        sqlParts.orderClauses = [...sqlParts.orderClauses, ...parameter.orderBy];
                    }
                }
            }
        });
    };
};

exports.queryForRanking = queryForRanking;

const applyOrdering = (sqlParts, columnSpecs, transformed, fieldNames) => {
    if (!fieldNames) {
        return;
    }
    for (let fieldName of fieldNames) {
        const columnSpec = columnSpecs[fieldName];
        if (transformed || !columnSpec) {
            sqlParts.orderClauses.push(fieldName);
        } else {
            const columnName = columnSpec.column;
            if (!columnName) {
                throw new Error("No Column name for " + JSON.stringify(columnSpec));
            }
            sqlParts.orderClauses.push(columnName);
        }
    }
};

const isWildcardTerm = term => term.endsWith('*');

const difficultRegexp = /^[\d]{1,2}:\*$/;
const isDifficultTerm = term => difficultRegexp.test(term);

/*
 * The purpose of two step search is to improve performance by first performing a narrowing search
 * with easy (not common) terms, rather than passing common terms directly to postgres.
 * The perf improvement is significant
 */
exports.twoStepSearch = (columnSpec, idColumn) => (sqlParts, params) => {
    if (!params.q) {
        return;
    }
    const tsQuery = params.autocomplete ?
        toPgSuggestQuery(params.q) :
        toPgSearchQuery(params.q);
    const terms = tsQuery.split(' & ');
    const difficultTerms = terms.filter(isDifficultTerm);
    const nonDifficultTerms = terms.filter(term => !isDifficultTerm(term));
    const hasNarrowingTerm = terms.filter(term => (!isWildcardTerm(term) && term.length >= 2) || term.length >= 5).length > 0;
    if (hasNarrowingTerm && difficultTerms.length > 0) {
        const nonDifficultAlias = dbapi.addSqlParameter(sqlParts, nonDifficultTerms.join(' & '));
        const difficultAlias = dbapi.addSqlParameter(sqlParts, difficultTerms.join(' & '));
        const firstPassQuery = {
            select: [idColumn],
            from: sqlParts.from,
            whereClauses: sqlParts.whereClauses,
            groupBy: '',
            orderClauses: []
        };
        sqlUtil.addSelect(columnSpec, 'tsv', firstPassQuery, params);
        dbapi.addWhereClause(firstPassQuery, searchWhereClause(nonDifficultAlias, columnSpec));
        const secondPassQuery = {
            select: [idColumn],
            from: ['firstPassIds'],
            whereClauses: [],
            groupBy: '',
            orderClauses: [],
            limit: 2000
        };
        dbapi.addWhereClause(secondPassQuery, searchWhereClause(difficultAlias, {}));

        sqlUtil.addSelect(columnSpec, 'tsv', sqlParts, params);
        const unordered = {
            select: ['a.*'],
            from: [`ids, LATERAL (SELECT ${sqlParts.select.join(',')} from ${sqlParts.from.join(' ')} where ids.${idColumn} = ${idColumn}) a`],
            whereClauses: [],
            groupBy: '',
            orderClauses: []
        };
        Object.assign(sqlParts, {
            with:
                [[firstPassQuery, 'firstPassIds'],
                    [secondPassQuery, 'ids'],
                    [unordered, 'unordered']],
            select: ['unordered.*'],
            from: ['unordered'],
            whereClauses: [],
            groupby: '',
            orderClauses: [],
        });
        params.transformedQuery = true;
        exports.searchRank(sqlParts, params);
    } else {
        return exports.search(columnSpec)(sqlParts, params);
    }
};

exports.addSearchTransform = (columnSpec, sqlParts, params, tsQuery, limit) => {
    const parameterAlias = dbapi.addSqlParameter(sqlParts, tsQuery);
    sqlUtil.addSelect(columnSpec, 'tsv', sqlParts, params);
    dbapi.addWhereClause(sqlParts, searchWhereClause(parameterAlias, columnSpec));
    if (limit) {
        sqlParts.limit = limit;

    }
    var query = dbapi.createQuery(sqlParts);
    var transformedQuery = {
        select: ['*'],
        from: ['(' + query.sql + ') AS searchResult'],
        whereClauses: [],
        groupBy: '',
        orderClauses: [],
        sqlParams: query.params
    };
    _.extend(sqlParts, transformedQuery);
    params.transformedQuery = true;

};

exports.searchFilter = columnSpec => (sqlParts, params) => {
    if (notNull(params.q)) {
        const tsQuery = params.autocomplete ?
            toPgSuggestQuery(params.q) :
            toPgSearchQuery(params.q);
        exports.addSearchTransform(columnSpec, sqlParts, params, tsQuery, 1000);
    }
};

exports.searchRank = (sqlParts, params) => {
    if (notNull(params.q)) {
        const tsQuery = params.autocomplete ?
            toPgSuggestQuery(params.q) :
            toPgSearchQuery(params.q);
        const rankAlias = dbapi.addSqlParameter(sqlParts, queryForRanking(tsQuery));
        sqlParts.orderClauses.unshift(searchOrderClause(rankAlias));
    }
};

const searchRankPreferName = (sqlParts, params) => {
    if (notNull(params.q)) {
        const tsQuery = params.autocomplete ?
            toPgSuggestQuery(params.q) :
            toPgSearchQuery(params.q);
        const tsRankQueryAlias = dbapi.addSqlParameter(sqlParts, queryForRanking(tsQuery));
        const tsExactQuery = tsQuery.replace(':*', '');
        const tsExactQueryAlias = dbapi.addSqlParameter(sqlParts, queryForRanking(tsExactQuery));
        const exactRankExpr = sqlRankExpr(tsExactQueryAlias, `to_tsvector('adresser', navn)`);
        const byNameRankExpr = sqlRankExpr(tsRankQueryAlias, `setweight(to_tsvector('adresser', navn), 'A')`);
        const defaultRankExpr = sqlRankExpr(tsRankQueryAlias, 'tsv');
        const orderClauses = [`${exactRankExpr} DESC`, `${byNameRankExpr} DESC`, `${defaultRankExpr} DESC`];
        sqlParts.orderClauses = [...orderClauses, ...sqlParts.orderClauses];
        const qAlias = dbapi.addSqlParameter(sqlParts, params.q);
        sqlParts.orderClauses.push(`levenshtein(lower(navn), lower(${qAlias}), 2, 1, 3)`);
    }
};

exports.searchRankStednavne = searchRankPreferName;


/*
 * Applies a search query and orders the results by rank
 * assumes the search query parameter is 'q',
 * and that the search field is 'tsv'.
 */
exports.search = function (columnSpec, orderFields) {
    orderFields = orderFields || [];
    return function (sqlParts, params) {
        exports.searchFilter(columnSpec)(sqlParts, params);
        exports.searchRank(sqlParts, params);
        if (notNull(params.q)) {
            applyOrdering(sqlParts, columnSpec, params.transformedQuery, orderFields);
        }
    };
};


function toOffsetLimit(paging) {
    if (paging.side && paging.per_side) {
        return {
            offset: (paging.side - 1) * paging.per_side,
            limit: paging.per_side
        };
    } else {
        return {};
    }
}

exports.paging = function (columnSpec, key, alwaysOrderByKey) {
    return function (sqlParts, params) {
        var offsetLimit = toOffsetLimit(params);
        _.extend(sqlParts, offsetLimit);
        if (params.per_side || alwaysOrderByKey) {
            applyOrdering(sqlParts, columnSpec, params.transformedQuery, key);
        }
    };
};

// Transform a JSON polygon parameter to a WKT
function polygonTransformer(paramValue) {
    var mapPoint = function (point) {
        return "" + point[0] + " " + point[1];
    };
    var mapPoints = function (points) {
        return "(" + _.map(points, mapPoint).join(", ") + ")";
    };
    var mapPolygon = function (poly) {
        return "POLYGON(" + _.map(poly, mapPoints).join(", ") + ")";
    };
    return mapPolygon(paramValue);
}

// Generates WHERE clauses for whether the queried object intersects a given geometric shape
// Supported shapes are a poloygon or a circle.
exports.geomWithin = function (geomOrFunc) {
    return function (sqlParts, params) {
        let geom;
        if (_.isFunction(geomOrFunc)) {
            geom = geomOrFunc(params);
        } else {
            geom = geomOrFunc || 'geom';
        }
        var srid = params.srid || 4326;
        var sridAlias;
        if (params.polygon || params.cirkel) {
            sridAlias = dbapi.addSqlParameter(sqlParts, srid);
        }
        if (params.polygon) {
            var polygonAlias = dbapi.addSqlParameter(sqlParts, polygonTransformer(params.polygon));
            dbapi.addWhereClause(sqlParts, "ST_Intersects(ST_Transform(ST_GeomFromText(" + polygonAlias + ", " + sridAlias + "), 25832), " + geom + ")");
        }
        if (params.cirkel) {
            var args = params.cirkel.split(',');
            var x = parseFloat(args[0]);
            var y = parseFloat(args[1]);
            var r = parseFloat(args[2]);
            var point = "POINT(" + x + " " + y + ")";
            var pointAlias = dbapi.addSqlParameter(sqlParts, point);
            var radiusAlias = dbapi.addSqlParameter(sqlParts, r);
            dbapi.addWhereClause(sqlParts, "ST_DWithin(" + geom + ", ST_Transform(ST_GeomFromText(" + pointAlias + "," + sridAlias + "), 25832), " + radiusAlias + ")");
        }
    };
};

// Adds an ORDER BY clause which returns the object closest to the specified X- and Y parameters.
// Sets limit to 1.
exports.reverseGeocoding = function (geom, noLimit) {
    geom = geom || 'geom';
    return function (sqlParts, params) {
        if (params.reverseGeocodingNearest !== false && notNull(params.x) && notNull(params.y)) {
            if (!params.srid) {
                params.srid = 4326;
            }
            // This WHERE clause does not affect the result of the query,
            // but apparently helps the query planner.
            dbapi.addWhereClause(sqlParts, `${geom} IS NOT NULL`);

            var orderby =
                `${geom} <-> ST_Transform(ST_SetSRID(ST_Point(` +
                dbapi.addSqlParameter(sqlParts, params.x) + ", " +
                dbapi.addSqlParameter(sqlParts, params.y) + "), " +
                dbapi.addSqlParameter(sqlParts, params.srid) + "), 25832)::geometry";
            sqlParts.orderClauses.push(orderby);
            if (!noLimit) {
                sqlParts.limit = "1";
            }
        }
    };
};

exports.adgangsadresseGeoFilter = function (sqlParts, params) {
    const geomColumn = params.geometri !== 'adgangspunkt' ? 'vejpunkt_geom' : 'geom';
    exports.reverseGeocoding(geomColumn)(sqlParts, params);
    exports.geomWithin(geomColumn)(sqlParts, params);
};

// Adds a where clause which requires the queried object to contain the point specified by the x and y parameters
exports.reverseGeocodingWithin = function (geomOrFunc) {
    return function (sqlParts, params) {
        let geom;
        if (_.isFunction(geomOrFunc)) {
            geom = geomOrFunc(params);
        } else {
            geom = geomOrFunc || 'geom';
        }
        const reverseGeocoding = exports.reverseGeocoding(geom);
        if (params.reverseGeocodingNearest) {
            return reverseGeocoding(sqlParts, params);
        } else if (notNull(params.x) && notNull(params.y)) {
            if (!params.srid) {
                params.srid = 4326;
            }
            const xAlias = dbapi.addSqlParameter(sqlParts, params.x);
            const yAlias = dbapi.addSqlParameter(sqlParts, params.y);
            const sridAlias = dbapi.addSqlParameter(sqlParts, params.srid);
            const pointSql = `ST_Transform(ST_SetSRID(ST_Point(${xAlias}, ${yAlias}), ${sridAlias}), 25832)`;
            if (params.reversewithindistance) {
                const distAlias = dbapi.addSqlParameter(sqlParts, params.reversewithindistance);
                dbapi.addWhereClause(sqlParts, `ST_Distance(${geom}, ${pointSql}) < ${distAlias}`);
            } else {
                dbapi.addWhereClause(sqlParts, `ST_Contains(${geom}, ${pointSql})`);
            }
        }
    };
};

exports.postnummerStormodtagerFilter = function () {
    return function (sqlParts, params) {
        if (typeof (params.stormodtagere) !== 'undefined' && !params.stormodtagere) {
            dbapi.addWhereClause(sqlParts, 'NOT stormodtager');
        }
    };
};

exports.toPgSearchQuery = toPgSearchQuery;

exports.includeInvalidAdgangsadresser = function (sqlParts, params) {
    if (!params.medtagugyldige) {
        dbapi.addWhereClause(sqlParts, `postnr IS NOT NULL AND husnr IS NOT NULL AND vejnavn IS NOT NULL and vejnavn <> '' and geom is not null`);
    }
};

exports.includeDeletedNavngivenVej = (sqlParts, params) => {
    if (!params.medtagnedlagte) {
        dbapi.addWhereClause(sqlParts, 'nv.darstatus in (2,3)');
    }
};

exports.includeDeletedAdgangsAdresses = (sqlParts, params) => {
    if (!params.medtagnedlagte) {
        dbapi.addWhereClause(sqlParts, 'a_status in (2,3)')
    }
};

exports.includeDeletedAdresses = (sqlParts, params) => {
    if (!params.medtagnedlagte) {
        dbapi.addWhereClause(sqlParts, 'e_status in (2,3)')
    }
};

exports.includeDeletedVejstykker = (sqlParts, params) => {
    if (!params.medtagnedlagte) {
        dbapi.addWhereClause(sqlParts, 'vejstykker.darstatus in (2,3)');
    }
};
