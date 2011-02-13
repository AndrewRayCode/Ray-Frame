var sys    = require('sys'),
    log = require('./lib/logger'),
    fs = require('fs'),
    templater = require('./lib/templater'),
    utils = require('./lib/utils'),
    couch_client = require('../node-couchdb/index.js').createClient(5984, 'localhost'),
    couch = couch_client.db('rayframe'),
    access_functions = module.exports;

// These functions, currently wired up to post methods in sever.js, are access / update functions accessible from the website URL. The syntax is such:
// { role: {functions_available_to_that_role}}
// This sets up a chain of security. Note that if a role has access to a function, so does the role above that. It cascades
exports.functions = {
    admin: {
        // TODO
        removeListItem: function(req, res, pageData, urlData, couch) {

        },
        getField: function(req, res, pageData, urlData, couch) {
            couch.getDoc(req.body.id, function(err, doc) {
                if(err) {
                    log.error('Error getting main doc from couch: ',err);
                    res.send({status:'failure', message:err});
                    return;
                }
                res.send({status:'success', value:doc[req.body.field]});
            });
        },
        // This is when the user clicks add on a list. We will save an object in the database that just has the new item's
        // template on it. We won't create a URL object for it because it doesn't yet have a title.
        addListItem: function(req, res, pageData, urlData, couch) {
            var instructions = templater.getInstructions(req.body.plip);

            // Save a temporary document in couch, let it create the key
            couch.saveDoc({template: req.body.view}, function(err, saved) {
                if(err) {
                    log.error('Error saving list item: ',err);
                    res.send({status:'failure', message:err});
                    return;
                }
                // Get the document the list is on for context
                couch.getDoc(instructions.doc_id, function(err, doc) {
                    if(err) {
                        log.error('Error getting main doc from couch: ',err);
                        res.send({status:'failure', message:err});
                        return;
                    }
                    templater.getListItems(instructions, doc, saved, function(err, items) {
                        templater.renderList(items, instructions, urlData, doc, function(err, rendered) {
                            if(err) {
                                log.error('Error rendering list: ',err);
                                res.send({status:'failure', message:err});
                                return;
                            }
                            res.send({status:'success', result:rendered, new_id: saved.id});
                        });
                    });
                });
            });
        },
        saveListItem: function(req, res, pageData, urlData, couch) {
            var list_instr = templater.getInstructions(req.body.list_plip),
                item_instr = templater.getInstructions(req.body.item_plip);

            function beginUpdate(pageData, urlData) {
                // Update the current document's list with the new id
                var arr = pageData[list_instr.field];
                if(!list_instr.type) {
                    pageData[list_instr.field] = arr && arr.length ? arr.concat(item_instr.doc_id) : [item_instr.doc_id];
                }

                // Get the stub item in the list to update its title field
                couch.getDoc(item_instr.doc_id, function(err, docToAdd) {
                    if(err) {
                        res.send({status:'failure', message:err.message});
                        return;

                    }
                    // Update the title field of the item in the list
                    docToAdd.title = req.body.title;

                    // urlData will come in as the url object for the item that has the list on it
                    // Now that we have the title we can generate the new public facing URL
                    var newLiveUrl = utils.newUrlFromId(urlData._id, req.body.title);

                    // make a new url object for the new item to be added to the list
                    var url = {
                        // The database-safe new url
                        _id: utils.sanitizeUrl(newLiveUrl),
                        // Reference to the newly added item
                        reference: item_instr.doc_id,
                        // Copy the parent chain of url object ids and simply add the current id to the chain
                        parents: urlData.parents.concat(urlData._id)
                    };

                    // Save the parent, the new item, and the new url object
                    couch.bulkDocs({docs: [pageData, docToAdd, url]}, function(err, result) {
                        if(err) {
                            res.send({status:'failure', message:err.message});
                        } else {
                            res.send({status:'success', new_url:newLiveUrl});
                        }
                    });
                });
            }

            // If this list belongs to the current URL we are on
            if(list_instr.doc_id == pageData._id) {
                beginUpdate(pageData, urlData);
            // If this list is in an embedded oject on the page, like an include or a sub list
            } else {
                couch.getDoc(list_instr.doc_id, function(err, correctPageData) {
                    if(err) {
                        res.send({status:'failure', message:err.message});
                        return;
                    }
                    couch.view('master', 'url', {key: list_instr.doc_id}, function(err, result) {
                        if(err) {
                            res.send({status:'failure', message:err.message});
                        } else if(result.rows.length < 1) {
                            // No url found. Special case, like if we are updating a list on the global template that has no URL object. Then we use
                            // the current url data
                            beginUpdate(correctPageData, urlData);
                        } else {
                            beginUpdate(correctPageData, result.rows[0].doc);
                        }
                    });
                });
            }
        },
        getTemplates: function(req, res, pageData, urlData, couch) {
            templater.listTemplates(function(err, files) {
                if(err) {
                    res.send({status:'failure', message:err.message});
                    return;
                }
                res.send({status:'success', templates:files});
            });
        },
        update: function(req, res, pageData, urlData, couch) {
            var parts = req.body.field.split(':');

            couch.getDoc(parts[0], function(err, doc) {
                doc[parts[1]] = req.body.value;
                couch.saveDoc(doc._id, doc, function(err, dbres) {
                    if(err) {
                        res.send({status:'failure', message:err});
                    } else {
                        res.send({status:'success', new_value:req.body.value});
                    }
                });
            });
        },
        updateList: function(req, res, pageData, urlData, couch) {
            var parts = req.body.field.split(':');

            couch.getDoc(parts[0], function(err, doc) {
                doc[parts[1]] = req.body.value;
                couch.saveDoc(doc._id, doc, function(err, dbres) {
                    if(err) {
                        res.send({status:'failure', message:err});
                    } else {
                        res.send({status:'success', rendered_item:req.body.value});
                    }
                });
            });
        }
    }
};
