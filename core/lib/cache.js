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
            for(var id in knowns[pageId][key]) {
                if(!(id in knowns)) {
                    keys.push(id);
                }
            }
        }
    }
    // All remaining in 'unknowns' array is now lists

    // Count the remaining
    var total = (!!keys.length) + Object.keys(lists).length,
        processed = 0,
        hasErrored;

    function checkIfFinished() {
        if(!hasErrored && (++processed == total)) {
            cb();
        }
    }

    // TODO: If unknowns do not need extra things in them like {url:...}, unkowns should come in as array of keys not {key: false}
    if(total) {
        if(keys.length) {
            // Get all documents that we know exist by key
            cache.getDocsByKey(keys, function(err, docs) {
                if(err || hasErrored) {
                    hasErrored = true;
                    return cb(err);
                }
                for(var x = 0, doc; doc = docs[x++];) {
                    // Modify `knowns` object in place. This is where we add items. Adding locals for convenience. May not be best way
                    knowns[doc._id] = {model: doc, locals: {}};
                }

                checkIfFinished();
            });
        }

        // Get all lists
        for(var listName in lists) {

            // Query the list and get its items
            (function(listData, listName) {

                var model = knowns[pageId].model;

                // Set the parent's fieldname to an empty array
                if(!model[listData.field]) {
                    model = model[listData.field] = [];
                }

                cache.getList(listName, listData, pageId, function(err, rows) {
                    // Get out if someone else errored
                    if(hasErrored) {
                        return;
                    } else if(err) {
                        hasErrored = true;
                        return cb(err);
                    }

                    for(var x = 0, row; row = rows[x++];) {
                        // Add the item to the list of knowns
                        knowns[row._id] = {model: row, locals: {}};

                        // Add the item to the parent's list field if there isn't an array of ids
                        if(!listData.userSort) {
                            model.push(row._id);
                        }
                    }

                    checkIfFinished();
                });
            })(lists[listName], listName);
        }

    // Everything is a known
    } else {
        cb();
    }
};

exports.getList = function(viewName, viewData, parentKey, cb) {
    var queryParams = {
        key: parentKey
    }, userSort = viewData.userSort;

    if(userSort) {
        queryParams.include_docs = true;
    }

    this.couch.view('master', viewName, queryParams, function(err, result) {
        if(err) {
            return cb(new Error('Error querying couch view `' + viewName + ':`' + err.error + ', ' + err.reason));
        } else if(!result.rows.length) {
            return cb(null, []);
        }

        var docs = [];

        // Docs will come back with the 'doc' field from how the view is structured
        if(userSort) {
            for(var x = 0, row; row = result.rows[x++];) {
                // TODO: We should get it here, and delete the parent key from known ids
                if(row.doc._id != parentKey) {
                    docs.push(row.doc);
                }
            }
        // This is a regular view
        } else {
            for(var x = 0, row; row = result.rows[x++];) {
                docs.push(row.value);
            }
        }
        cb(null, docs);
    });
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


