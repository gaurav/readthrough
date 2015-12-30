// Load some libraries.
var http = require('http');
var https = require('https');

// Set up Express middleware.
var express = require('express');
var app = express();

// Set up port and public directories.
app.set('port', (process.env.PORT || 5000));
app.use(express.static(__dirname + '/public'));

// views is directory for all template files
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

// Set up database connection with MongoDB.
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI);

// Set up sessions.
const session = require('express-session');
const MongoStore = require('connect-mongo')(session);

app.use(session({
    secret: '--cookie--secret--',
    resave: false, // I think?
    saveUninitialized: false, // maybe?
    store: new MongoStore({ mongooseConnection: mongoose.connection })
}));

// The login page is most people's first introduction
// to the app.
app.get('/login', function(req, res) {
    res.render('pages/login', {
        page_title: 'Log in or create an account',
        user: null
    });
});

// Login to Pocket using OAuth.

// Set up PassportJS for authentication.

// This is as far as you get without a login.
function get_user_or_redirect(req, res) {
    if('user' in req.session) {
        return req.session.user;
    }

    res.redirect('/login');
    return false;
}

app.get('/', function(req, res) {
    user = get_user_or_redirect(req, res);
    if(!user) return;

    res.render('pages/index', {
        page_title: null,
        user: user
    });
});

app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});


