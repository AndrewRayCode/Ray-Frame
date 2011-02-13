var sys    = require('sys'),
	log = require('./logger'),
	path = require('path'),
    fs = require('fs'),
	couch_client = require('../../../node-couchdb/index.js').createClient(5984, 'localhost'),
    couch = couch_client.db('rayframe'),
    utils = module.exports;

// Search backwards from and NOT including s looking for c (regex or string)
exports.rFind = function(str, c, s) {
    s = s === undefined ? str.length : s+1;
    if(typeof c == 'string') {
        c = new RegExp('^'+c+'$');
    }
    while(s--) {
        if(str[s].match(c)) {
            return s;
        }
    }
    return -1;
};

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

exports.newUrlFromId = function(urlId, title) {
    // homepage is special case
    return (urlId == '~' ? '/' : '/'+urlId.replace(/~/g, '/')) +
        (title ? (urlId == '~' ? '' : '/')+utils.generateTitle(title) : '');
};

// TODO: This needs to be available on the front end as well for title generation
exports.generateTitle = function(str) {
    return str.replace(/\s+/, '_').replace(/\W/g, '').trim();
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

exports.formatFunction = function(func, replaces) {
    func = func.toString(), l = replaces.length;
    for(var x=0; x<l; x++) {
        func = func.replace('$'+(x+1), replaces[x]);
    }
    return func;
};

exports.readDir = function(start, callback) {
  fs.lstat(start, function(err, stat) {
    if (err) {return callback(err);}
    if (stat.isDirectory()) {

      fs.readdir(start, function (err, files) {
        var coll = files.reduce(function (acc, i) {
          var abspath = path.join(start, i);

          if (fs.statSync(abspath).isDirectory()) {
            utils.readDir(abspath, callback);
            acc.dirs.push(abspath);
          } else {
            acc.names.push(abspath);
          }

          return acc;
        }, {"names": [], "dirs": []});

        return callback(null, start, coll.dirs, coll.names);
      });
    } else {
      return callback(new Error("path: " + start + " is not a directory"));
    }
  });
};
