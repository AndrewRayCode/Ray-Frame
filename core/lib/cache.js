var cache = module.exports,
    log = require('simple-logger');

cache.fillIn = function(knowns, unknowns, cb) {
    log.error('knowns ' , knowns ,' and ',unknowns);
    // Delete anything already known
    for(var key in unknowns) {
        if(unknowns[key] === false) {
            if(key in knowns) {
                delete unknowns[key];
            }
        }
    }

    // Count the remaining
    var keys = Object.keys(unknowns),
        processed = 0;

    // TODO: If unknowns do not need extra things in them like {url:...}, unkowns should come in as array of keys not {key: false}
    if(keys.length) {
        cache.getDocsByKey(keys, function(err, docs) {
            if(err) {
                return cb(err);
            }
            for(var x = 0, doc; doc = docs[x++];) {
                // Modify `knowns` object in place. This is where we add items
                knowns[doc._id] = {variables: doc, locals: {}};
            }
            cb();
        });
    // Everything is a known
    } else {
        cb();
    }
};

cache.getDocsByKey = function(keys, cb) {
    this.couch.getDocsByKey(keys, function(err, result) {
        if(err) {
            return cb(err);
        }
        var docs = [];
        for(var x = 0, doc; doc = result.rows[x++];) {
            docs.push(doc.doc);
        }
        cb(null, docs);
    });
};
