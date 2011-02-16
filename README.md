### What
Ray-Frame is a web framework for building dynamic websites. It has a simple, django-ish templating language designed to let you do exactly what you want while abstracting out common tasks. It provides inline-editing on all of your templates so there is no separate interface to edit pages. The philosophies driving Ray-Frame are listed below

### The Ray-Frame Mentality
I am making Ray-Frame for several reasons. There is not currently a CMS solution in Node.js, and I don't feel like the CMS I want is out there yet. If there were one word I would choose for the heart of Ray-Frame it would be PRAGMATIC. Here are some of the ideas behind Ray-Frame to help you understand this project:

* Ray-Frame's editing is mainly inline editing, as in if you're logged in / authenticated, you can go to your homepage, same URL, and edit content inline.
* I don't like having to go to a separate page to edit your content. You don't know what it looks like live and there is a back-and-forth change-this-does-it-look-good, no-of-course-not, repeat, workflow. Inline editing allows you to see your content inline, as it would appear live
* Using Node.js has the cool and untapped benefit of being able to use the same code server side and client side. Think form validation.
* I want give the developer (and designer) as much freedom as possible while still being pragmatic. For example, I don't want to ever completely sandbox the user. If you want to write a plugin that needs a library, go ahead and include it. Write all the raw JS code you want.
* However, I want to solve common problems for website development, like pagination, comments, and tags.
* Continuing from the above two points, there are things Ray-Frame will not address. Developer freedom is key. Ray-Frame will NOT include version control for code/templates (version history of actual in-database website content will be included). It will NOT force you to use any specific editor like Visual Studio (ick [go Node!]). It will not require you to ever edit anything through a proprietary in-browser whatever-editor. I am a VIM lover, and hate CMSes that lock you into either Visual Studio or an online editor.
* I don't like abstraction over HTML. I want to let developers write HTML exactly how they want to. I've spent too many days fighting with unchangable widget markup trying to put some CSS element the designer wants on the site. Your HTML is your HTML, change it how you need.
* Widgets (not currently implemeneted) should be simple to write because community content is king for successful web software. But again, widgets should not sandbox the writer into anything, if you want to access some core function of the site go ahead, just research it well.

### Dependencies
node v0.2.5
    Right now this is running on node v0.2.5. The couch client is dependant on this version as well.
    I do have plans to upgrade at some point, but not yet, as I require the older version of node for work.
    Although, since I patched the couch client, I haven't seen many major issues yet.

express
    URL: 
        https://github.com/visionmedia/express
    Instructions:
        Clone and install with npm install

nodeunit
    URL:
        https://github.com/caolan/nodeunit 
    Instructions:
        Same as above

My fork of node-couchdb
    URL:
        https://github.com/DelvarWorld/node-couchdb

    Instructions:
        You can see how I'm including it in server.js. For now it's just a relative reference.
        Sorry, you have to deal, and clone the repo to the same local path (put in same folder ray-frame is in).

CouchDb
    URL:
        For Windows I suggest CouchIO http://www.couch.io/get

### How to start Ray-Frame
You must have a CouchDB instance running to start. Simply run:

> node runme.js

And then hit http://localhost:8080/ and you will see your test website! All of the code is currently in server.js

### How to run the tests
nodeunit core/test/suites

### Basic Technical Overview + Rules
* I have a basic workflow diagram mapped out, I will add it to this file or the Wiki at some point
* There are TODOs all over the code. Feel free to pick one and work on it
* Any client to server communication should receive a JSON response with at minumum {status: (one of) ['failure', 'warning', 'success', 'processing']
* All client-side JavaScript admin functionality goes on the RayFrame object
