var RayFrameUtils = function() {
    this.$ = jQuery.noConflict(true);
    this.post = function(url, data, cb) {
        var send = {current_id: current_id, current_url_id: current_url_id};
        url = access_url + '/' + url;
        if(cb) {
            // If we got a data object we will have cb
            this.$.extend(send, data);
        } else {
            cb = data;
        }
        this.$.post(url, send, cb);
    };
    this.Transients = {};
};
var RayFrame = new RayFrameUtils();

(function(){

    // TODO: Namespace the edit classes to avoid potential website conflicts
    var hover = RayFrame.$('<a></a>').addClass('edit_btn'),
        listHover = RayFrame.$('<a></a>').addClass('list_edit_btn'),
        cancel = RayFrame.$('<a></a>').addClass('cancel_btn').click(cancelClick),
        send = RayFrame.$('<a></a>').addClass('send_btn').click(sendClick),
        updateList = RayFrame.$('<a></a>').addClass('list_update_btn').click(updateListClick),
        currentEditor = {};
        
    RayFrame.$(document).ready(function() {
        wireUp(document.body).click(bodyClickHandler);
    });

    var utils = function() {

    };

    function wireUp(elem) {
        var pos;
        elem = RayFrame.$(elem);

        // Edit buttons for fields
        elem.find('.edit_me').each(function(i, item) {
            item = RayFrame.$(item);
            pos = item.css('border', '2px solid red').offset();
            hover.clone().css({top:pos.top, left:pos.left}).appendTo(document.body).data('match', item);
        });

        // Edit buttons for lists
        elem.find('.edit_list').each(function(i, item) {
            item = RayFrame.$(item);
            pos = item.css('border', '2px solid brown').offset();
            listHover.clone().css({top:pos.top, left:pos.left}).appendTo(document.body).data('match', item);
        });
        return elem;
    }

    // Catch all body clicks and trigger functionality if needed
    function bodyClickHandler(evt) {
        var t = RayFrame.$(evt.target);
        if(t.hasClass('edit_btn')) {
            editClick(t);
        } else if(t.hasClass('list_edit_btn')) {
            listClick(t);
        }
    }

    function listClick(elem) {
        RayFrame.post('getTemplates', function(data) {
            if(data.status == 'success') {
                currentEditor.target = elem.data('match');
                currentEditor.viewList = RayFrame.$('<div></div>').addClass('list_views').appendTo(document.body).click(viewSelect);

                for(var x=0; x<data.templates.length; x++) {
                    RayFrame.$('<div></div>').text(data.templates[x]).appendTo(currentEditor.viewList);
                }
            } else {
                alert(data.status+': '+data.message);
            }
        });
    }

    // We selected a view from the list of available ones
    function viewSelect(evt) {
        var t = RayFrame.$(evt.target);
        if(!t.hasClass('list_views')) {
            // Tell the server our current list plip and the view we found. The server will return us a new one
            RayFrame.post('addListItem', {plip:currentEditor.target.attr('id'), view:t.text()}, function(data) {
                if(data.status == 'success') {
                    currentEditor.viewList.remove();
                    wireUp(currentEditor.target.html(data.result));
                    if(data.result.indexOf('a')) {
                        
                    }

                    var pos = currentEditor.target.offset();
                    currentEditor.send = updateList.css({display:'block', top:pos.top, left:pos.left + 15}).appendTo(document.body);
                } else {
                    alert(data.status+': '+data.message);
                }
            });
        }
    }

    function editClick(elem) {
        currentEditor.edit = elem.css({display: 'none'});
        currentEditor.target = elem.data('match').css({display:'none'});
        var pos = elem.data('match').offset();

        currentEditor.cancel = cancel.css({display:'block', top:pos.top, left:pos.left}).appendTo(document.body);
        currentEditor.send = send.css({display:'block', top:pos.top, left:pos.left + 15}).appendTo(document.body);

        elem.data('match').css({display:'none'});
        buildEditor(elem.data('match').attr('id'));
    }

    function buildEditor(id) {
        id = '#'+id.replace(/:/g, '\\:');
        currentEditor.input = RayFrame.$('<input></input>').attr('type', 'text').val(RayFrame.$(id).html()).insertAfter(RayFrame.$(id)).click(function(e){e.preventDefault();});
    }

    function updateListClick(evt) {
        var t = RayFrame.$(evt.target);
        RayFrame.post('updateList', {field:currentEditor.target.attr('id'), value:currentEditor.input.val()}, function(data) {
            if(data.status == 'success') {
                currentEditor.target.html(data.new_value);
                closeEdit(t.data('match'));
            } else {
                alert(data.status+': '+data.message);
            }
        });
    }

    function sendClick(evt) {
        var t = RayFrame.$(evt.target);
        RayFrame.post('update', {field:currentEditor.target.attr('id'), value:currentEditor.input.val()}, function(data) {
            if(data.status == 'success') {
                currentEditor.target.html(data.new_value);
                closeEdit(t.data('match'));
            } else {
                alert(data.status+': '+data.message);
            }
        });
    }

    function cancelClick() {
        closeEdit();
    }

    function closeEdit(item) {
        currentEditor.cancel.css('display', 'none');
        currentEditor.send.css('display', 'none');
        currentEditor.input.remove();
        currentEditor.target.css({display: 'block'});
        currentEditor.edit.css({display: 'block'});
    }
})();

