var RayFrame = new (function() {
    this.$ = jQuery.noConflict(true);
    this.post = function(url, data, cb) {
        var send = {current_id: current_id, current_url_id: current_url_id};
        url = access_urls.admin + '/' + url; // Assuming admin here
        if(cb) {
            // If we got a data object we will have cb
            this.$.extend(send, data);
        } else {
            cb = data;
        }
        this.$.post(url, send, function(data) {
            if(data.status == 'success') {
                cb(data);
            } else {
                alert(data.status+': '+data.message);
            }
        });
    };
    this.Transients = {};
})();

(function($){

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
})(RayFrame.$);
