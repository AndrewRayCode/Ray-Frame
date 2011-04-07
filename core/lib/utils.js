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
// This method is for making url keys from live urls to put into the database
exports.sanitizeUrl = function(str) {
    // Never have leading or trailing `.`s, except homepage which is just '~'
    return 'url:'+str.replace(/\//g, '~').replace(/(.+)~$/, '$1').replace(/^~(.+)/, '$1');
};

exports.newUrlFromId = function(urlId, title) {
	urlId = urlId.replace('url:','');
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
            var d = new Date(),
            new_obj = {
                template: template, 
                modified: d,
                created: d
            };
			// TODO: Here we create the db entry even if the template file does not exist.
			// We should check for it and error up there if it doesn't exist
			utils.saveDoc(couch, path, new_obj, function(err, added) {
                new_obj._id = added.id;
                new_obj.rev = added.rev;
				cb(err, new_obj);
			});
		} else {
			cb(null, firstres);
		}
	});
};

exports.formatFunction = function(func) {
    func = func.toString();
    for(var x=1, l=arguments.length; x<l; x++) {
        func = func.replace('$'+(x+1), sys.inspect(arguments[x]));
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

exports.addChildByTitle = function(couch, par, field, child, parUrl, cb) {
	utils.addChild(couch, 'title', par, field, child, parUrl, cb);
};

exports.addChildById = function(couch, par, field, child, parUrl, cb) {
	utils.addChild(couch, '_id', par, field, child, parUrl, cb);
};

exports.addChild = function(couch, useForName, par, field, child, parUrl, cb) {
	utils.saveDoc(couch, child, function(err, saved) {
		if(err) {
			return cb(err);
		}
		// We want the id and rev of the saved object combined with the metadata passed in. this is our new object.
		// Also, map id to _id to remain consistent with other places. Always try to use _id, stupid couch client
		child._id = saved.id;
		child.rev = saved.rev;
		var url = {
			// The database-safe new url
			_id: utils.sanitizeUrl(utils.newUrlFromId(parUrl._id, child[useForName])),
			// Reference to the newly added item
			reference: saved.id,
			// Copy the parent chain of url object ids and simply add the current id to the chain
			parents: parUrl.parents.concat(parUrl._id)
		};

		// Update the current document's list with the new id
		var arr = par[field];
		par[field] = arr && arr.length ? arr.concat(child._id) : [child._id];

		utils.bulkDocs(couch, [url, par], function(err, result) {
			if(err) {
				cb(err);
			}
			cb(null, child);
		});
	});
};

exports.saveDoc = function(couch, id, doc, cb) {
    // TODO: Could do versioning of fields here
    doc.modified = new Date();
    couch.saveDoc(id, doc, cb);
};

exports.bulkDocs = function(couch, docs, cb) {
    var d = new Date();
    docs.forEach(function(doc) {
        doc.modified = d;
    });
    couch.bulkDocs({docs: docs}, cb);
};

exports.authSession = function(req) {
    if(!req.session.user) {
        req.session.user = {
            name: 'Anonymous',
            auth: false
        };
    }
};
