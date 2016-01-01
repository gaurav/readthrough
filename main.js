// Load some libraries.
var http = require('http');
var https = require('https');
var os = require('os');

// Set up .env so we have the same environment as heroku.
require('dotenv').load();

// Set up Express middleware.
var express = require('express');
var app = express();

// Set up port and public directories.
app.set('port', (process.env.PORT || 5000));
app.use(express.static(__dirname + '/public'));

// views is directory for all template files
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

// Set up Passport for authentication.
const passport = require('passport');
const PocketStrategy = require('passport-pocket');

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
app.use(passport.initialize());
app.use(passport.session());

// Set up Pocket-based authentication.
if(!process.env.POCKET_CONSUMER_KEY) {
    throw new Error("No POCKET_CONSUMER_KEY specified!");
}

// Passport Set serializers
passport.serializeUser(function(user, done) {
    user['displayName'] = user['username'];
    done(null, user);
});

passport.deserializeUser(function(obj, done) {
    done(null, obj);
});

var pocketStrategy = new PocketStrategy({
    consumerKey:    process.env.POCKET_CONSUMER_KEY,
    callbackURL:    "http://" + process.env.HOSTNAME + ":" + app.get('port') + "/login/pocket/callback",
}, function(username, accessToken, done) {
    process.nextTick(function() {
        return done(null, {
            username: username,
            accessToken: accessToken
        });
    });
});

passport.use(pocketStrategy);

// Authentication routes.
app.get('/login/pocket', passport.authenticate('pocket'), function(req, res) {
    res.redirect('/');
});
app.get('/login/pocket/callback', passport.authenticate('pocket', { failureRedirect: '/login' }),
function(req, res) {
    res.redirect('/');
});

// And when it all goes wrong.
app.get('/logout', function(req, res) {
    req.session.destroy();
    res.redirect('/');
});

// The login page is most people's first introduction
// to the app.
app.get('/login', function(req, res) {
    res.render('pages/login', {
        page_title: 'Log in or create an account',
        user: null,
        error: req.query.error
    });
});

// This is as far as you get without a login.
function get_user_or_redirect(req, res) {
    if('user' in req) {
        return req.user;
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


