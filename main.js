// Load NodeJS libraries.
var http = require('http');
var https = require('https');
var os = require('os');

// Load other libraries.
var mongo = require('mongojs');
var monq = require('monq');
var uuidlib = require('node-uuid');

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
var monqclient = monq(process.env.MONGODB_URI);
var mongo = monqclient.db;

// Set up sessions.
const session = require('express-session');
const MongoStore = require('connect-mongo')(session);

app.use(session({
    secret: '--cookie--secret--',
    resave: false, // I think?
    saveUninitialized: false, // maybe?
    store: new MongoStore({ db: mongo })
}));
app.use(passport.initialize());
app.use(passport.session());

// Set up Pocket-based authentication.
if(!process.env.POCKET_CONSUMER_KEY) {
    throw new Error("No POCKET_CONSUMER_KEY specified!");
}

// Passport serializers

// Passports are stored in the 'User' table, so we need a model for that.
users = mongo.collection('users');

passport.serializeUser(function(user, done) {
    users.findOne({accessToken: user.accessToken}, function(err, obj) {
        if(obj != null) {
            // Load an existing user.
            done(err, obj.uuid);
        } else {
            // Create a new user.
            user.uuid = uuidlib.v1();
            users.insert(user);
            done(null, user.uuid);
        }
    });
});

passport.deserializeUser(function(uuid, done) {
    // Create or insert a new user with this UUID.
    users.findOne({
        uuid: uuid
    }, function(err, user) {
        // If we have to look up this user, let's also
        // queue up a 'sync' call.
        var tasks = monqclient.queue(uuid);
        tasks.enqueue('sync', {}, {});

        done(err, user);
    });
});

var pocketStrategy = new PocketStrategy({
    consumerKey:    process.env.POCKET_CONSUMER_KEY,
    callbackURL:    "http://" + process.env.HOSTNAME + "/login/pocket/callback",
}, function(username, accessToken, done) {
    process.nextTick(function() {
        return done(null, {
            displayName: username,
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

app.get('/', 
    passport.authenticate('pocket', { failureRedirect: '/login' }),
    function(req, res) {
        var queue = monqclient.queue(req.user.uuid);
        queue.collection.find({queue: req.user.uuid}, function(err, tasks) {
            res.render('pages/index', {
                page_title: null,
                user: req.user,
                tasks: tasks
            });
        });
    }
);

app.listen(app.get('port'), function() {
    console.log('Node app is running on port', app.get('port'));
});


