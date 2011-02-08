// TODO: Namespace the edit classes to avoid potential website conflicts
var hover = $('<a></a>').addClass('edit_btn'),
	listHover = $('<a></a>').addClass('list_edit_btn'),
	cancel = $('<a></a>').addClass('cancel_btn').click(cancelClick),
	send = $('<a></a>').addClass('send_btn').click(sendClick),
	updateList = $('<a></a>').addClass('list_update_btn').click(updateListClick),
	currentEditor = {};
	
$(document).ready(function() {
	wireUp(document.body).click(bodyClickHandler);
});

function wireUp(elem) {
    var pos;
    elem = $(elem);
	elem.find('.edit_me').each(function(i, item) {
        item = $(item);
        pos = item.css('border', '2px solid red').offset();
        hover.clone().css({top:pos.top, left:pos.left}).appendTo(document.body).data('match', item);
	});

	elem.find('.edit_list').each(function(i, item) {
        item = $(item);
        pos = item.css('border', '2px solid brown').offset();
        listHover.clone().css({top:pos.top, left:pos.left}).appendTo(document.body).data('match', item);
	});
	return elem;
}

function bodyClickHandler(evt) {
    var t = $(evt.target);
	if(t.hasClass('edit_btn')) {
		editClick(t);
	} else if(t.hasClass('list_edit_btn')) {
		listClick(t);
	}
}

function listClick(elem) {
	$.post('/getTemplates', function(data) {
        if(data.status == 'success') {
            currentEditor.target = elem.data('match');
            currentEditor.viewList = $('<div></div>').addClass('list_views').appendTo(document.body).click(viewSelect);

            for(var x=0; x<data.templates.length; x++) {
                $('<div></div>').text(data.templates[x]).appendTo(currentEditor.viewList);
            }
        } else {
            alert(data.status+': '+data.message);
        }
    });
}

function viewSelect(evt) {
    var t = $(evt.target);
	if(!t.hasClass('list_views')) {
		$.post('/getListView',{view: t.text()}, function(data) {
            if(data.status == 'success') {
                currentEditor.viewList.remove();
                wireUp(currentEditor.target.html(data.parsed));

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
	currentEditor.input = $('<input></input>').attr('type', 'text').val($(id).html()).insertAfter($(id));
}

function updateListClick(evt) {
    var t = $(evt.target);
	$.post('/updateList', {field:currentEditor.target.attr('id'), value:currentEditor.input.val()}, function(data) {
        if(data.status == 'success') {
            currentEditor.target.html(data.new_value);
            closeEdit(t.data('match'));
        } else {
            alert(data.status+': '+data.message);
        }
    });
}

function sendClick(evt) {
    var t = $(evt.target);
	$.post('/update', {field:currentEditor.target.attr('id'), value:currentEditor.input.val()}, function(data) {
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
