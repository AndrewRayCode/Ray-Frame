var sys    = require('sys'),
    log = require('./lib/logger'),
    fs = require('fs'),
    templater = require('./lib/templater'),
    couch_client = require('../node-couchdb/index.js').createClient(5984, 'localhost'),
    couch = couch_client.db('rayframe'),
    access_functions = module.exports;

// These functions, currently wired up to post methods in sever.js, are access / update functions accessible from the website URL. The syntax is such:
// { role: {functions_available_to_that_role}}
// This sets up a chain of security. Note that if a role has access to a function, so does the role above that. It cascades
exports.functions = {
    admin: {
        addListPage: function(req, res, pageData, urlData, couch) {

        },
        removeListPage: function(req, res, pageData, urlData, couch) {

        },
        addListItem: function(req, res, pageData, urlData, couch) {
            var instructions = templater.getInstructions(req.body.plip);

            // Save a temporary document in couch, let it create the key
            couch.saveDoc({template: req.body.view}, function(err, saved) {
                if(err) {
                    log.error('Error saving list item: ',err);
                    res.send({status:'failure', message:err});
                } else {
                    // Get the document the list is on for context
                    couch.getDoc(instructions.doc_id, function(err, doc) {
                        if(err) {
                            log.error('Error getting main doc from couch: ',err);
                            res.send({status:'failure', message:err});
                        } else {
                            // Update the list with new temporary document key
                            doc[instructions.field] = [saved.id];

                            templater.renderList(instructions, urlData, doc, function(err, rendered) {
                                if(err) {
                                    log.error('Error rendering list: ',err);
                                    res.send({status:'failure', message:err});
                                } else {
                                    res.send({status:'success', result:rendered});
                                }
                            });
                        }
                    });
                }
            });
        },
        getTemplates: function(req, res, pageData, urlData, couch) {
            fs.readdir('templates/', function(err, files) {
                if(err) {
                    res.send({status:'failure', message:err.message});
                } else {
                    var clean = [];
                    // Filter out VIM swap files for example
                    for(var x=0; x<files.length; x++) {
                        if(/\.html$/.test(files[x])) {
                            clean.push(files[x]);
                        }
                    }
                    res.send({status:'success', templates:clean});
                }
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
