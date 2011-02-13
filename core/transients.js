var transients = module.exports,
    utils = require('./lib/utils'),
    log = require('./lib/logger');

exports.ellip = function(str) {
    return str && str.length > 200 ? (str.substring(0, utils.rFind(str, /\s/, 200)) + '&hellip') : str;
};
