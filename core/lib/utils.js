var sys    = require('sys'),
	log = require('./logger'),
	path = require('path'),
    fs = require('fs'),
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
    return str.replace(/\s+/g, '_').replace(/\W/g, '').trim();
};

exports.getOrCreate = function(couch, path, template, cb) {
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
    // Use lstat to resolve symlink if we are passed a symlink
    fs.lstat(start, function(err, stat) {
        if(err) {
            return callback(err);
        }
        var found = {dirs: [], files: []},
            total = 0,
            processed = 0;
        function isDir(abspath) {
            fs.stat(abspath, function(err, stat) {
                if(stat.isDirectory()) {
                    found.dirs.push(abspath);
                    // If we found a directory, recurse!
                    utils.readDir(abspath, function(err, data) {
                        found.dirs = found.dirs.concat(data.dirs);
                        found.files = found.files.concat(data.files);
                        if(++processed == total) {
                            callback(null, found);
                        }
                    });
                } else {
                    found.files.push(abspath);
                    if(++processed == total) {
                        callback(null, found);
                    }
                }
            });
        }
        // Read through all the files in this directory
        if(stat.isDirectory()) {
            fs.readdir(start, function (err, files) {
                total = files.length;
                for(var x=0, l=files.length; x<l; x++) {
                    isDir(path.join(start, files[x]));
                }
            });
        } else {
            return callback(new Error("path: " + start + " is not a directory"));
        }
    });
};
