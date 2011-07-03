var cache = module.exports,
    log = require('simple-logger');

cache.fillIn = function(knowns, unknowns, pageId, cb) {
    //log.error('knowns ' , knowns ,' and ',unknowns);
    var keys = [],
        lists = {},
        unknown;

    // Delete anything already known
    for(var key in unknowns) {
        unknown = unknowns[key];

        if(unknown === false) {
            if(!(key in knowns)) {
                keys.push(key);
            }
        // Delete any lists that already exist on parents
        } else if(unknown.list) {
            if(!knowns[pageId][unknown.field]) {
                lists[key] = unknown;
            }
        } else if(unknown.ids) {
            //log.warn('oh hi ',knowns[pageId]);
            for(var id in knowns[pageId][key]) {
                if(!(id in knowns)) {
                    keys.push(id);
                }
            }
        }
    }
    // All remaining in 'unknowns' array is now lists

    //log.warn(knowns, unknowns);
    // Count the remaining
    var total = (!!keys.length) + Object.keys(lists).length,
        processed = 0;

    function checkIfFinished() {
        if(++processed == total) {
            cb();
        }
    }

    // TODO: If unknowns do not need extra things in them like {url:...}, unkowns should come in as array of keys not {key: false}
    if(total) {
        // Get all documents that we know exist by key
        cache.getDocsByKey(keys, function(err, docs) {
            if(err) {
                return cb(err);
            }
            for(var x = 0, doc; doc = docs[x++];) {
                // Modify `knowns` object in place. This is where we add items. Adding locals for convenience. May not be best way
                knowns[doc._id] = {variables: doc, locals: {}};
            }
            checkIfFinished();
        });

        // Get all lists
        for(var listName in lists) {
            // Query the list and get its items
            (function(fieldName, listName) {
                // Set the parent's fieldname to an empty array
                knowns[pageId].variables[fieldName] = [];
                cache.getList(listName, pageId, function(err, rows) {
                    if(err) {
                        return cb(err);
                    }
                    for(var x = 0, row; row = rows[x++];) {
                        // Add the item to the list of knowns
                        knowns[row._id] = {variables: row, locals: {}};
                        // Add the item to the parent's list field
                        knowns[pageId].variables[fieldName].push(row._id);
                    }
                    checkIfFinished();
                });
            })(lists[listName].field, listName);
        }
    // Everything is a known
    } else {
        cb();
    }
};

exports.getList = function(viewName, parentKey, cb) {
    this.couch.view('master', viewName, {key: parentKey}, function(err, result) {
        if(err || !result.rows.length) {
            return cb(err, []);
        }
        var docs = [];
        for(var x = 0, row; row = result.rows[x++];) {
            docs.push(row.value);
        }
        cb(null, docs);
    });
}

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


    //// Only user sorts cause documents to get an array of ids
    //if(instructions.sort == 'user') {
        //var field = pageData[instructions.field];

        //if(field && field.length) {
            //couch.getDocsByKey(field, function(err, result) {
                //if(err) {
                    //cb(err);
                    //return;
                //}
                //var docs = [];
                //for(var x=0, l=result.rows.length; x<l; x++) {
                    //docs.push(result.rows[x].doc);
                //}
                //if(newItem) {
                    //docs.push(newItem);
                //}
                //cb(null, docs);
            //});
        //} else {
            //// We are not updating the parent's list with the new id here, we are just temporarly storing it to render the list. The new item
            //// exists in the database without a title, but if the user cancels or leaves the page then we have more work to do. See saveListItem
            //// for where this array of ids is actually updated. Is this a good idea? You tell me.
            //cb(null, newItem ? [newItem] : []);
        //}
    //// For everything else a view is made
    //} else {


