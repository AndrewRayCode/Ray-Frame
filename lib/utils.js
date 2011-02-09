var sys    = require('sys'),
	log = require('./logger'),
	path = require('path'),
	couch_client = require('../../node-couchdb/index.js').createClient(5984, 'localhost'),
    couch = couch_client.db('rayframe'),
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

exports.getOrCreate = function(path, template, cb) {
	couch.getDoc(path, function(err, firstres) {
		if(err) {
			// This thing is not yet in the database. Let's put it there!
			var new_obj = {template: template};
			// TODO: Here we create the db entry even if the template file does not exist.
			// We should check for it and error up there if it doesn't exist
			couch.saveDoc(path, new_obj, function(err, added) {
                new_obj._id = added.id;
                new_obj.rev = added.rev;
				cb(err, new_obj);
			});
		} else {
			cb(null, firstres);
		}
	});
    };
