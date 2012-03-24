var sys    = require('util'),
    log = require('simple-logger'),
    fs = require('fs'),
    templater = require('./lib/templater'),
    cache = require('./lib/cache'),
    utils = require('./lib/utils');

// These functions, currently wired up to post methods in sever.js, are access / update functions accessible from the website URL. The syntax is such:
// { role: {functions_available_to_that_role}}
// This sets up a chain of security. Note that if a role has access to a function, so does the role above that. It cascades
module.exports = [{
    name: 'admin',
    includes: 
        '<link rel="stylesheet" href="/admin/admin.css" />'
        + '<script src="/admin/jquery-1.5.min.js"></script><script src="/admin/admin_functions.js"></script>',
    accessURLPrefix: 'access', // Change for one more quip of security
    wrapTemplateFields: true,
    accessors: {
        // TODO
        removeListItem: function(req, res, pageData, urlData, couch) {

        },
        getField: function(req, res, pageData, urlData, couch) {
            couch.get(req.body.id, function(err, doc) {
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
            var instructions = req.body.instructions,
                doc_id = instructions.doc_id,
                user = req.session.user,
                doc = {
                    template: req.body.view,
                    parent_id: doc_id
                };

            // Save a temporary document in couch, let it create the key
            utils.saveDoc(couch, doc, function(err, saved) {
                if(err) {
                    res.send({status:'failure', message:err});
                    return;
                }
                // Get the document the list is on for context
                couch.get(doc_id, function(err, doc) {
                    if(err) {
                        log.error('Error getting main doc from couch: ',err);
                        res.send({status:'failure', message:err});
                        return;
                    }

                    var viewName = instructions.view + user.role,
                        fakeData = {},
                        childId = saved.id,
                        view = templater.templateCache[viewName];

                    fakeData[childId] = {
                        variables: {title: 'title'},
                        locals: {}
                    };

                    // TODO: Please abstract this because we basically duplicate it in templater
                    var listTemplateView = instructions.listBody + user.role,
                        cachedList = templater.rawCache[listTemplateView],
                        pieces = cachedList.buffers.element.split('this.replacechild;');

                    if(!view) {
                        var msg = 'View not found! `' + view + '`';
                        log.error(msg);
                        return res.send({status:'failure', message:msg});
                    }

                    // function('cache', 'templater', 'user', 'pageId', 'data', 'cb');
                    view(cache, templater, user, childId, fakeData, function(err, parsed) {
                        if(err) {
                            log.error('Error rendering list: ',err);
                            return res.send({status:'failure', message:err});
                        }
                        var complete = pieces[0] + parsed + pieces[1];
                        res.send({status: 'success', result: complete, new_id: childId});
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
                couch.get(item_instr.doc_id, function(err, docToAdd) {
                    if(err) {
                        return res.send({status:'failure', message:err.message});
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
                    utils.bulkDocs(couch, [pageData, docToAdd, url], function(err, result) {
                        if(err) {
                            return res.send({status:'failure', message:err.message});
                        }
						res.send({status:'success', new_url:newLiveUrl});
                    });
                });
            }

            // If this list belongs to the current URL we are on
            if(list_instr.doc_id == pageData._id) {
                beginUpdate(pageData, urlData);
            // If this list is in an embedded oject on the page, like an include or a sub list
            } else {
                couch.get(list_instr.doc_id, function(err, correctPageData) {
                    if(err) {
                        res.send({status:'failure', message:err.message});
                        return;
                    }
                    couch.view('master', 'url', {key: list_instr.doc_id}, function(err, result) {
                        if(err) {
                            res.send({status:'failure', message:err.message});
                        } else if(result.rows.length < 1) {
							var home = utils.sanitizeUrl('/');
                            // No url found. Special case, like if we are updating a list on the global template that has no URL object. Then we use
                            // the url data of the home page, because who knows where the include is
                            if(urlData._id == home) {
                                beginUpdate(correctPageData, urlData);
                            } else {
                                couch.get(home, function(err, homepageUrlData) {
                                    if(err) {
                                        return res.send({status:'failure', message:err.message});
                                    }
                                    beginUpdate(correctPageData, homepageUrlData);
                                });
                            }
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
            var instructions = req.body.instructions;

            couch.get(instructions.doc_id, function(err, doc) {

                doc[instructions.field] = req.body.value;

                utils.saveDoc(couch, doc._id, doc, function(err, dbres) {
                    if(err) {
                        return res.send({status:'failure', message:err});
                    }
                    res.send({status:'success', new_value:req.body.value});
                });
            });
        },
        updateList: function(req, res, pageData, urlData, couch) {
            var parts = req.body.field.split(':');

            couch.get(parts[0], function(err, doc) {
                doc[parts[1]] = req.body.value;
                utils.saveDoc(couch, doc._id, doc, function(err, dbres) {
                    if(err) {
                        return res.send({status:'failure', message:err});
                    }
                    res.send({status:'success', rendered_item:req.body.value});
                });
            });
        }
    }
}, {
    name: 'public',
    accessors: {
        addComment: function(req, res, pageData, urlData, couch) {
            var child = {
                title: req.body.title,
                body: req.body.body
            };
            utils.addChildById(couch, pageData, 'comments', child, urlData, function(err, child) {
                res.send('err? '+sys.inspect(err)+' child? '+sys.inspect(child));
            });
        }
    }
}];
