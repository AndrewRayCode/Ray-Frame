var sys    = require('sys'),
	log = require('./logger'),
	path = require('path'),
    utils = module.exports;

exports.guessContentType = function(file) {
	var ext = path.extname(file);
	if(ext == '.css') {
		return 'text/css';
	} else if(ext == '.js') {
		return 'text/javascript';
	}
};

// Couch can't handle `/` in keys, so relace with `~`
exports.sanitizeUrl = function(str) {
    // Never have leading or trailing `.`s, except homepage which is just '~'
    return str.replace(/\//g, '~').replace(/(.+)~$/, '$1').replace(/^~(.+)/, '$1');
};

exports.unsanitizeUrl = function(str, title) {
    // Never have leading or trailing `.`s, except homepage which is just '~'
    return '/'+str.replace(/~/g, '/')+(title ? '/'+this.generateTitle(title) : '');
};

// TODO: This needs to be available on the front end as well for title generation
exports.generateTitle = function(str) {
    return str.replace(/\s+/, '_').replace(/\w/g, '').trim();
};
