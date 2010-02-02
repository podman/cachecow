/*
 * Ext JS Library 0.30
 * Copyright(c) 2006-2009, Ext JS, LLC.
 * licensing@extjs.com
 * 
 * http://extjs.com/license
 */
var socket;
var currentCMD;
var currentSlab;
var slabs;
var itemsRE = /^STAT items:(\d+):number (\d+)$/;
var keysRE = /^ITEM (.*) \[(\d+) b; (\d+) s\]$/;
var keys;
var store;
var loadingMask;
var currentKey;
var currentKeyBytes;
var state = 0;
var grid;
var addWindow;
var addForm;
var connectWindow;
var connectForm;
var filter_field;

Ext.onReady(function(){
	 // Let's add a couple new convenience methods to Ext.LoadMask
	Ext.apply(Ext.LoadMask.prototype,{
	      visible:false,
	         onBeforeLoad : function(){
	            if(!this.disabled && !this.visible){
	                 this.el.mask(this.msg, this.msgCls);
	                 this.visible = true;
	            }
	        },
	        onLoad : function(){
	            this.el.unmask(this.removeMask);
	            this.visible = false;
	        },
	    show:function(msg, append){
	       if(!this.disabled){    
	         if(msg){
	            this.msg= append?this.msg + '<br/>'+ msg:msg;
	        }
	        this.onBeforeLoad();
	       }
	    },
	        showDefer:function(msg,fn,config){
	            config || (config={});
	            this.show(msg, config.append||false);
	        if(fn){
	           config = Ext.apply({scope:this,millis:100,"arguments":[],appendArguments:false},config);
	           fn.defer(config.millis,config.scope,[].concat(config.arguments),config.appendArguments);
	        }
	    },
	    hide:function(){  this.onLoad(); }
	});
	// maintain window state automatically
	var win = new Ext.air.NativeWindow({
		id: 'mainWindow',
		instance: window.nativeWindow
	});
	
	store = new Ext.data.SimpleStore({
	        fields: [
	           {name: 'key'},
	           {name: 'bytes', type: 'int'},
	           {name: 'timestamp'}
	        ]
	    });

    filter_field = new Ext.form.TextField({
        emptyText: 'enter search term',
        name: 'keyFilter',
        enableKeyEvents: true
    });

    filter_field.on('keyup', function(){handleKeyFilter();});

	grid = new Ext.grid.GridPanel({
	        store: store,
	        columns: [
	            {id:'key',header: "Key", width: 160, sortable: true, dataIndex: 'key'},
	            {header: "Size", width: 75, sortable: true, renderer: Ext.util.Format.fileSize, dataIndex: 'bytes'},
	            {header: "timestamp", width: 110, sortable: true, dataIndex: 'timestamp'}
	        ],
	        stripeRows: true,
			height: 200,
			split: true,
	        autoExpandColumn: 'key',
	        title:'Memcache Keys',
			region:'north',
			margins:'0 0 5 0',
			enableHdMenu: false,
			sm: new Ext.grid.RowSelectionModel({singleSelect:false}),
			loadMask: {msg: 'Loading...'},
			tbar:[{
                text: 'Connect',
                tooltip: 'Connect to memcached',
                iconCls: 'connect',
                handler: connect
            }, '-', {
				text:'Add Key',
				tooltip:'Add a new key',
				iconCls:'add',
				handler: addKey
			}, '-', {
				text:'Remove Key',
				tooltip:'Remove the selected key',
				iconCls:'remove',
				handler: removeKey
			}, '-', {
				text: 'Refresh',
				tooltip: 'Refresh all keys',
				iconCls: 'refresh',
				handler: refresh
			}, '-', {
				text: 'Flush All',
				tooltip: 'Flush all keys',
				iconCls: 'flush',
				handler: flush
			},'->', filter_field
            ]
			
	    });
		grid.getSelectionModel().on('selectionChange', onKeySelect);
		
		
	    grid.render('key-grid');
		var viewport = new Ext.Viewport({
		            layout:'border',
		            items:[grid,
					{
					    region:'center',
	                    contentEl: 'key-content',
	                    split:true,
	                    margins:'0 0 0 0',
					}]
		});
	addForm = new Ext.FormPanel({
		labelWidth: 75, // label settings here cascade unless overridden
		frame:true,
		title: 'Add Key',
        bodyStyle:'padding:5px 5px 0',
        defaultType: 'textfield',
        items: [{
			fieldLabel: 'Key',
			name: 'key',
			allowBlank:false
		},new Ext.form.TextArea({
			fieldLabel: 'Value',
			name: 'value',
			allowBlank: false,
			height: 100,
			width: 'auto'
		})],
        buttons: [{
           text: 'Add',
			handler: doAddKey
        },{
           text: 'Cancel',
			handler: closeAddWindow
        }]
    });
	
	
	addWindow = new Ext.Window({
		applyTo     : 'add-win',
		modal: true,
		closeAction :'hide',
		plain: true,
		items: [addForm],
		resizable: false,
		autoHeight: true,
		draggable: false
	});

    connectForm = new Ext.FormPanel({
		labelWidth: 75, // label settings here cascade unless overridden
		frame:true,
		title: 'Connect to Memcached',
        bodyStyle:'padding:5px 5px 0',
        defaultType: 'textfield',
        items: [{
			fieldLabel: 'Host',
			name: 'host',
			allowBlank:false
		}],
        buttons: [{
           text: 'Connect',
			handler: doConnect
        },{
           text: 'Cancel',
			handler: closeConnectWindow
        }]
    });

    connectWindow = new Ext.Window({
        applyTo : 'connect-win',
        modal: true,
        closeAction: 'hide',
        plain: true,
        items: [connectForm],
        resizeable: false,
        autoHeight: true,
        draggable: false
    });

	win.show();
	win.instance.activate();
	socket = new air.Socket();
	socket.addEventListener( air.Event.CONNECT, onSocketOpen ); 
	socket.addEventListener( air.ProgressEvent.SOCKET_DATA, onSocketData );
	socket.addEventListener(air.Event.CLOSE, onSocketClose); 
	socket.addEventListener(air.IOErrorEvent.IO_ERROR, onSocketIOError); 
	
	socket.connect( 'localhost', 11211 );
	
});

function handleKeyFilter() {
    var searchTerm = filter_field.getValue();
    if (searchTerm == "") {
        store.clearFilter();
    } else {
        store.filter('key', searchTerm, true);
    }
}

function doConnect() {
    var f = connectForm.getForm().getValues();
    var host = f.host;
    connectWindow.hide();
    socket.close();
    socket.connect(host, 11211);
}

function closeConnectWindow() {
    connectForm.getForm().reset();
    connectForm.hide();
}

function doAddKey() {
	var f = addForm.getForm().getValues();
	
	var key = f.key;
	var val = f.value;
	addWindow.hide();
	sendCMD('set ' + key + ' 0 0 ' + val.length + '\r\n' + val);	
}

function closeAddWindow() {
	addForm.getForm().reset();
	addWindow.hide();
}
function sendCMD(cmd) {
	grid.loadMask.show();
	currentCMD = (cmd.indexOf('cachedump') == -1) ? cmd : 'stats cachedump';
	currentCMD = (currentCMD.indexOf('get') == -1) ? currentCMD : 'get';
	currentCMD = (currentCMD.indexOf('delete') == -1) ? currentCMD : 'delete';
	var ba = new air.ByteArray(); 
	ba.writeMultiByte(cmd + "\r\n", "UTF-8"); 
	socket.writeBytes(ba);
	socket.flush();
}
function refresh() {
	sendCMD('stats items');
}
function connect() {
    connectForm.getForm().reset();
    connectWindow.center();
    connectWindow.show();
}
function addKey() {
	addForm.getForm().reset();
	addWindow.center();
	addWindow.show();
}
function removeKey() {
	if (grid.getSelectionModel().getCount() > 1) {
        Ext.Msg.confirm('Flush All Keys?', 'Are you sure you want to delete all selected keys from memcached?', onConfirmRmMultiple, this);
    } else {
        if (currentKey) {
		    sendCMD('delete ' + currentKey);
		    Ext.get('key-content').update("");
		    currentKey = null;
	    } else {
	    	Ext.Msg.alert('Error', 'You must select a key to remove.');
	    }
    }
}

function onConfirmRmMultiple() {
    Ext.get('key-content').update("");

    var rows =  grid.getSelectionModel().getSelections();

    for( var i = 0; i < rows.length; i++ ) {
        sendCMD('delete ' + rows[i].data.key);
    }
}

function flush() {
	Ext.Msg.confirm('Flush All Keys?', 'Are you sure you want to flush all keys from memcached?', onConfirmFlush, this);
}

function onConfirmFlush() {
	Ext.get('key-content').update("");
	sendCMD('flush_all 0');
}
function onKeySelect( sm ) {
	var rows = sm.getCount();
    
    if (rows > 1) {
        currentKey = null;
        Ext.get('key-content').update("<h2 class='multiple'>" + rows + " Keys Selected</h2>");
        return;
    } else if (rows <= 0 ) {
        Ext.get('key-content').update("");
        return;
    } else {
        var r = sm.getSelected();
        var key = r.data.key;
	    currentKey = key;
	    sendCMD('get ' + key);
    }
} 
function onSocketOpen( event )
{
    air.trace('connected!');
	// First send the boolean
    sendCMD('stats items');
    // Now we send the bytes to the service and
    // clear the buffer.
}
function onSocketData( event )
{
	var cleanBA = new air.ByteArray();
	socket.readBytes(cleanBA, 0, socket.bytesAvailable);    
	var data = cleanBA.readMultiByte(cleanBA.length, 'ISO-8859-1');
	cleanBA.position = 0;
	var lines = data.split('\r\n');
	
	switch(currentCMD) {
		case 'stats items':
			slabs = [];
			for (var i in lines) {
				var result = itemsRE.exec(lines[i]);
				if (result) {
					slabs.push([result[1], result[2]]);
				}
			}
			keys = [];
			if (slabs.length == 0) {
				store.removeAll();
				grid.loadMask.hide();
				return;
			}
			getKeys(0);
			break;
		case 'stats cachedump':
			for (var i in lines) {
				var result = keysRE.exec(lines[i]);
				if (result) {
                    var dt = new Date(result[3]*1000);
                    var H = dt.getHours() >= 10 ? dt.getHours() : "0" + dt.getHours();
                    var i = dt.getMinutes() >= 10 ? dt.getMinutes() : "0" + dt.getMinutes();
                    var s = dt.getSeconds() >= 10 ? dt.getSeconds() : "0" + dt.getSeconds();
                    var ds = dt.getFullYear() + "-" + (dt.getMonth() + 1) + "-" + dt.getDate() + "\t" + H + ":" + i + ":" + s;
    				keys.push([result[1], result[2], ds]);
				}
			}
			if (currentSlab < slabs.length-1) {
				currentSlab++;
				getKeys(currentSlab);
			} else {
				gotKeys();
			}
			break;
		case 'get':
			grid.loadMask.hide();
			var start = data.indexOf('\r\n') + 2;
			var stripped = data.replace(/VALUE[^\r\n]*/,"").replace(/END\r\n$/,""); 
			var header = "<h2 class='raw'>Raw</h2>";
			
			if (cleanBA[start] == '4' && cleanBA[start+1] == '8') {
				header = "<h2 class='marshal'>Ruby Marshalled</h2>";
			}
			Ext.get('key-content').update(header + Ext.util.Format.htmlEncode(stripped));
			break;
		
		case 'flush_all 0':
			for(var i in keys) {
				sendCMD('get ' + keys[i][0])
			}
		default:
			refresh();
			break;
	}
}
function getKeys(idx)
{
	currentSlab = idx;
	sendCMD('stats cachedump ' + slabs[idx][0] + ' ' + slabs[idx][1]);
}
function gotKeys()
{
	store.loadData(keys);
    var searchTerm = filter_field.getValue();
    if (searchTerm != "") {
        store.filter('key', searchTerm, true);
    }
	grid.loadMask.hide();
}
function onSocketClose(evetn) 
{
	air.trace('socket closed :(');
}
function onSocketIOError(error) 
{
	air.trace(error);
}