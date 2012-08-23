(function() {

var RayFrame = new (function() {
    var $ = this.$ = jQuery.noConflict(true);

    var events = $({}),
        me = this;

    this.events = events;

    this.bind = function(bindEvent, func) {
        events.bind(bindEvent, func);
        return this;
    };

    this.trigger = function() {
        events.trigger(arguments[0], Array.prototype.slice.call(arguments, 1));
        return this;
    };

    this.post = function(url, data, cb) {
        var send = {
            current_id: RayFrame.current_id,
            current_url_id: RayFrame.current_url_id
        };

        url = RayFrame.accessUrls[RayFrame.role] + '/' + url;

        if(cb) {
            // If we got a data object we will have cb
            $.extend(send, data);
        } else {
            cb = data;
        }

        $.post(url, send, function(data) {
            if(data.status == 'success') {
                cb(data);
            } else {
                alert(data.status+': '+data.message);
            }
        });
    };

    this.Widgets = {};

    this.init = function() {
        for(var widgetName in this.WidgetCatalog) {
            this.Widgets[widgetName] = new this.WidgetCatalog[widgetName];

            // Bind the edit event to the name of the widget, like triggering 'edit.text'
            // should call the edit method of the text widget. Anonymous function is for scope
            this.bind('edit.' + widgetName, function(bindEvent) {
                me.Widgets[widgetName].edit(bindEvent);
            });
        }
        return this;
    };
})();

this.RayFrame = RayFrame;

RayFrame.WidgetCatalog = {
    'default': function() {
        var me = this;

        this.edit = function(editEvent) {

            var $container = editEvent.$container,
                html = $container.html();
            this.$container = $container;

            $container.attr('contentEditable', true).focus();


            $container.bind('keypress.rayframe', function(keyEvent) {
                if(keyEvent.keyCode == 13) {
                    // Clean up the DOM
                    keyEvent.preventDefault();
                    me.result = $container.html();

                    me.destroy();

                    var completeEvent = {
                        originalEvent: editEvent, // pass it if we have it?
                        value: me.result,
                        instructions: editEvent.instructions,
                        type: 'edit.complete'
                    };
                    RayFrame.trigger(completeEvent);
                }
            });
        };

        this.getValue = function() {
            return this.result;
        };

        this.destroy = function() {
            this.$container.attr('contentEditable', null).unbind('keypress.rayframe').blur();
        };
    }
};

RayFrame.ListManager = function($wrapper, options) {
    for(var optionName in options) {
        this[optionName] = options[optionName];
    }

    var instructions = this.instructions || RayFrame.getInstructions($wrapper.attr('id')),
        me = this,
        insertDelegate = function(evt) {
            if(me.inserting) {
                return;
            }
            me.insertNewItem();
        };

    this.$list = $wrapper.find('q[id^="listItem"]:first').parent();

    if(instructions.addable !== false) {
        $wrapper
            .delegate('a.rayframe-action', 'click', insertDelegate)
            .bind('dblclick', insertDelegate);
    }

    this.insertButton = RayFrame.$('<a class="rayframe-add-item rayframe-action rayframe-button rayframe-small-button">+</a>').prependTo($wrapper);
    this.instructions = instructions;
    this.$wrapper = $wrapper;
};

RayFrame.ListManager.prototype.insertNewItem = function() {
    this.inserting = true;
    this.insertButton.fadeOut(200);

    var me = this;

    RayFrame.post('addListItem', {
        instructions: this.instructions
    }, function(data) {
        console.log(data.result);

        RayFrame.$(data.result).appendTo(me.$list);
        console.log('done');
    });
};

RayFrame.init().$(function() {
    var $ = RayFrame.$;

    var findEnd = function(node) {
        var betweens = [];
        while(node.nextSibling) {
            node = node.nextSibling;
            if(node) {
                if(node.nodeType === 8 && node.nodeValue.trim() === 'end') {
                    break;
                }
                betweens.push(node);
            }
        }
        return {
            end: node,
            betweens: betweens
        };
    };

    var comments = $('*').contents().filter(function() {
        return this.nodeType == 8 && !this.nodeValue.trim().indexOf('plip:');
    });

    for(var x = 0, comment; comment = comments[x++];) {
        var val = comment.nodeValue.trim();
            $c = $(comment),
            found = findEnd(comment),
            end = found.end,
            betweens = found.betweens,
            $end = $(end);

        val = val.split(':').slice(1);

        var $parent = $c.parent(),
            contents = $parent.contents(),
            first = contents[0], last = contents[contents.length - 1],
            $wrapper;

        if(first.nodeType === 3 && !first.nodeValue.trim()) {
            first = contents[1];
        }
        if(last.nodeType === 3 && !last.nodeValue.trim()) {
            last = contents[contents.length - 2];
        }

        // If the first is a comment and last is ending comment
        if( (first === comment && last === end) ) {
            $wrapper = $parent;
        } else {
            var $change = $(),
                repl;
            for(var i = 0, between; between = betweens[i++];) {
                if(between.nodeType === 3) {
                    $repl = $('<span>' + between.textContent + '</span>');
                    $(between).replaceWith($repl);
                    $change = $change.add($repl);
                } else {
                    $change = $change.add(between);
                }
            }
            $change.wrapAll('<span></span>');
            $wrapper = $change.eq(0).parent();
        }
        //$wrapper.css('background', '#ddf').attr('contenteditable', 'true');
    };

    $(document.body).click(bodyClickHandler);

    var instructions,
        $editable;
    $('.rayframe-edit').each(function(index, item) {
        $editable = $(item);
        instructions = RayFrame.getInstructions(item.id);

        if(instructions.widget == 'list') {
            new RayFrame.ListManager($editable);
        }
    });

    RayFrame.bind('edit.complete', completeEdit);

    function bodyClickHandler(clickEvent) {
        var $target = $(clickEvent.target);

        if($target.hasClass('rayframe-edit') && !RayFrame.disableEditing) {
            clickEvent.preventDefault();
            editElement($target, clickEvent);
        }
    }

    function editElement($element, initEvent) {
        if($element.attr('contentEditable') == true) {
            return;
        }
        var instructions = RayFrame.getInstructions($element.attr('id'));

        initEvent = initEvent || {};
        initEvent.type = 'edit.' + instructions.widget
        initEvent.instructions = instructions;
        initEvent.$container = $element;

        RayFrame.trigger(initEvent);
    }

    // The widget has done its due dilligence. Let's tell the server what's up
    function completeEdit(completeEvent) {
        if(completeEvent.instructions.isPlip) {

            RayFrame.disableEditing = true;
            RayFrame.post('update', {
                value: completeEvent.value,
                instructions: completeEvent.instructions
            }, function() {
                RayFrame.disableEditing = false;
            });
        }
    }

    function cancelEdit() {

    }

    //// TODO: Namespace the edit classes to avoid potential website conflicts
    //var hover = RayFrame.$('<a></a>').addClass('edit_btn'),
        //listHover = RayFrame.$('<a></a>').addClass('list_edit_btn'),
        //cancel = RayFrame.$('<a></a>').addClass('cancel_btn').click(cancelClick),
        //send = RayFrame.$('<a></a>').addClass('send_btn').click(sendClick),
        //updateList = RayFrame.$('<a></a>').addClass('list_update_btn').click(updateListClick),
        //currentEditor = {},
        //editButtons = {};
        
    //RayFrame.$(document).ready(function() {
        //wireUp(document.body).click(bodyClickHandler);
    //});

    //var utils = function() {

    //};

    //function wireUp(elem) {
        //var pos;
        //elem = RayFrame.$(elem);

        //// Edit buttons for fields
        //elem.find('.rayframe-edit').each(function(i, item) {
            //item = RayFrame.$(item);
            //pos = item.css('border', '2px solid red').offset();
            //editButtons[item.attr('id')] = hover.clone().css({top:pos.top, left:pos.left}).appendTo(document.body).data('match', item);
        //});

        //// Edit buttons for lists
        //elem.find('.edit_list').each(function(i, item) {
            //item = RayFrame.$(item);
            //pos = item.css('border', '2px solid brown').offset();
            //listHover.clone().css({top:pos.top, left:pos.left}).appendTo(document.body).data('match', item);
        //});
        //return elem;
    //}

    //// Catch all body clicks and trigger functionality if needed
    //function bodyClickHandler(evt) {
        //var t = RayFrame.$(evt.target);
        //if(t.hasClass('edit_btn')) {
            //editClick(t);
        //} else if(t.hasClass('list_edit_btn')) {
            //listClick(t);
        //}
    //}

    //function listClick(elem) {
        //RayFrame.post('getTemplates', function(data) {
            //currentEditor.target = elem.data('match');
            //currentEditor.viewList = RayFrame.$('<div></div>').addClass('list_views').appendTo(document.body).click(viewSelect);

            //for(var x=0; x<data.templates.length; x++) {
                //RayFrame.$('<div></div>').text(data.templates[x]).appendTo(currentEditor.viewList);
            //}
        //});
    //}

    //// We selected a view from the list of available ones
    //function viewSelect(evt) {
        //var t = RayFrame.$(evt.target);
        //if(!t.hasClass('list_views')) {
            //// Tell the server our current list plip and the view we found. The server will return us a new one
            //RayFrame.post('addListItem', {plip:currentEditor.target.attr('id'), view:t.text()}, function(data) {
                //currentEditor.viewList.remove();
                //wireUp(currentEditor.target.html(data.result));

                //// Save the list item, keep target as the list we are adding to
                //currentEditor.listItem = RayFrame.$('#'+data.new_id);
                //var titleField = currentEditor.listItem.find('span[id^="'+data.new_id+':title"]');
                
                //if(titleField.length) { 
                    ////instr = RayFrame.Transients.getInstructions(RayFrame.$(matches[l]).attr('id'));
                    //// This will get overwritten by the below trigger but we want to save the reference
                    //currentEditor.listEdit = currentEditor.target;
                    //// Trigger the edit event of the title field because when you add a new list item, title is the first thing you edit
                    //editButtons[titleField.attr('id')].trigger('click');
                    //// TODO: We have to rebind this if the user cancels!
                    //currentEditor.send.unbind('click').click(saveListItemClick);
                //} else {
                    //// TODO: If this thing has no title field we just want to put in a text box
                    //currentEditor.input = RayFrame.$('<input></input>').attr('type', 'text').insertAfter(currentEditor.listItem).click(function(e){e.preventDefault();});
                //}

                //// TODO: This is for if we aren't actually adding a new linkable object in the datablaze
                ////var pos = currentEditor.target.offset();
                ////currentEditor.send = updateList.css({display:'block', top:pos.top, left:pos.left + 15}).appendTo(document.body);
            //});
        //}
    //}

    //function saveListItemClick(evt) {
        //RayFrame.post('saveListItem', {
            //list_plip: currentEditor.listEdit.attr('id'),
            //item_plip: currentEditor.target.attr('id'),
            //title: currentEditor.input.val()
        //}, function(data) {
            //window.location = data.new_url;
        //});
    //}

    //function editClick(elem) {
        //var original_element = elem.data('match').css({display:'none'}),
            //pos = original_element.offset(),
            //id = original_element.attr('id'),
            //instrs = RayFrame.Transients.getInstructions(original_element.attr('id'));

        //currentEditor.edit = elem.css({display: 'none'});
        //currentEditor.target = original_element;

        //currentEditor.cancel = cancel.css({display:'block', top:pos.top, left:pos.left}).appendTo(document.body);
        //currentEditor.send = send.css({display:'block', top:pos.top, left:pos.left + 15}).appendTo(document.body);

        //if(instrs.renderFunc) {
            //RayFrame.post('getField', {id: instrs.doc_id, field: instrs.field}, function(unRendered) {
                //original_element.html(unRendered.value);
                //// we have the rendering function front end, but do we really need to use it? we need to go to back end to get original value
                //// anyway, unless I think of some way to render that out on load time...
                ////currentEditor.renderFunc = instrs.renderFunc;
                //buildEditor(original_element.attr('id'));
            //});
        //} else {
            //buildEditor(original_element.attr('id'));
        //}
    //}

    //function buildEditor(id) {
        //var found = RayFrame.$('#'+id.replace(/:/g, '\\:'));
        //currentEditor.input = RayFrame.$('<input></input>').attr('type', 'text').val(found.html()).insertAfter(found).click(function(e){
            //e.preventDefault();
        //}).focus().keydown(function(evt) {
            //if(evt.keyCode == 13) {
                //evt.preventDefault();
                //evt.stopPropagation();
                //currentEditor.send.trigger('click');
                //return false;
            //}
        //});
    //}

    //function updateListClick(evt) {
        //var t = RayFrame.$(evt.target);
        //RayFrame.post('updateList', {field:currentEditor.target.attr('id'), value:currentEditor.input.val()}, function(data) {
            //currentEditor.target.html(data.new_value);
            //closeEdit(t.data('match'));
        //});
    //}

    //function sendClick(evt) {
        //var t = RayFrame.$(evt.target);
        //RayFrame.post('update', {field:currentEditor.target.attr('id'), value:currentEditor.input.val()}, function(data) {
            //currentEditor.target.html(data.new_value);
            //closeEdit(t.data('match'));
        //});
    //}

    //function cancelClick() {
        //closeEdit();
    //}

    //function closeEdit(item) {
        //currentEditor.cancel.css('display', 'none');
        //currentEditor.send.css('display', 'none');
        //currentEditor.input.remove();
        //currentEditor.target.css({display: 'block'});
        //currentEditor.edit.css({display: 'block'});
    //}
});
})();
