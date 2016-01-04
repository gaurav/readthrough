// Load NodeJS libraries.
var http = require('http');
var https = require('https');
var os = require('os');
var querystring = require('querystring');

// Load other libraries.
var mongo = require('mongojs');
var uuidlib = require('node-uuid');
var monq = require('monq');

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

// Get ready to store items
var items = mongo.collection('items');

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
    // Clear all queues.
    var queue = monqclient.queue(req.user.uuid);
    queue.collection.remove({});

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
            items.aggregate([
                { "$project": { category: 1 }},
                { "$unwind": "$category" },
                { "$group": { _id: "$category", count: { $sum: 1 } } }
            ], function(inner_err, category_counts) {
                res.render('pages/index', {
                    page_title: null,
                    user: req.user,
                    tasks: tasks,
                    category_counts: category_counts
                });
            });
        });
    }
)

/*
 * Process jobs: each should take around five seconds or so, so if you
 * need a do a lot, queue up more jobs!
 *
 * TODO: Rewrite so it stores items per user!
 */
function process_job_from_queue(err, job) {
    console.log("process_job_from_queue(" + err + ", " + job + ")");

    if(err) console.log("Error in process_job_from_queue: " + err);
    if(!job) return;

    // console.log(job);

    var queue = monqclient.queue(job.data.queue);

    var accessToken = job.data.params.accessToken;
    if(!accessToken) {
        job.cancel(function() {});
        return;
    }

    switch(job.data.name) {
        case 'sync':
            // Sync from Pocket: download the next 100 items.
            var offset = job.data.params.offset || 0;
            var items_per_sync = 100;

            console.log("Querying from " + offset + " to " + (offset + items_per_sync));

            query = {
                consumer_key: process.env.POCKET_CONSUMER_KEY,
                access_token: accessToken,
                state: 'all',
                sort: 'newest',
                detailType: 'complete',
                offset: offset,
                count: items_per_sync
            };
            query_string = querystring.stringify(query);
            https.get('https://getpocket.com/v3/get?' + query_string, function(res) {
                var response = "";

                res.on('data', function(d) {
                    response += d;
                });

                res.on('end', function() {
                    // Okay, data ready!
                    json = JSON.parse(response);

                    var item_count = 0;
                    for (var item_id in json.list) {
                        if (json.list.hasOwnProperty(item_id)) {
                            item = json.list[item_id];

                            items.update({'item_id': 'pocket:' + item_id},
                                {
                                    'item_id': 'pocket:' + item_id,
                                    'url': item.given_url,
                                    'resolved_url': item.resolved_url,
                                    'title': item.given_title || item.resolved_title,
                                    'given_title': item.given_title,
                                    'resolved_title': item.resolved_title,
                                    'meta_url': 'https://getpocket.com/a/read/' + item_id,
                                    'excerpt': item.excerpt,
                                    'size': item.word_count,
                                    'category': item.tags,
                                    'date_added': new Date(item.time_added),
                                    'date_updated': new Date(item.time_updated),
                                    'date_read': new Date(item.time_read),
                                    'date_favorited': new Date(item.time_favorited),
                                    'pocket': item
                                },
                                {
                                    upsert: true
                                }
                            );

                            item_count++;
                        }
                    }

                    // console.log(json);

                    // Do we have an incomplete list? If not, let's ask for more!
                    // console.log("Keep going? " + item_count + " <=> " + items_per_sync);
                    if(item_count >= items_per_sync) {
                        queue.enqueue('sync', {
                            accessToken: accessToken,
                            offset: offset + items_per_sync
                        }, {});
                    }
    
                    job.complete(function() {});
                });
            }); 
    }
}

app.get('/tick',
    passport.authenticate('pocket', { failureRedirect: '/login' }),
    function(req, res) {
        var queue = monqclient.queue(req.user.uuid);
        queue.collection.find({queue: req.user.uuid}, function(err, tasks) {
            // Start a worker to execute exactly one task.
            queue.dequeue(process_job_from_queue);

            // Remove all completed jobs.
            queue.collection.remove({status: 'complete'});

            // If and only if the queue is empty, add a 'sync' job onto it.
            if(tasks.length == 0) {
                queue.enqueue('sync', {
                    accessToken: req.user.accessToken
                }, {});
            }

            res.status(200).json({
                error: null,
                tasks: tasks
            });
        });
    }
);

// Some middleware stuff to display results and RDF.

// results_to_html(req, res) -> requires req.items
function results_to_html(req, res) {
    res.render('pages/list', {
        page_title: req.title,
        user: req.user,
        items: req.items,
        offset: req.offset,
        count: req.count,
        total_count: req.total_count
    });
}

// results_to_atom(req, res) -> requires req.items
function results_to_atom(req, res) {
    res.type('application/atom+xml').render('pages/list_atom', {
        page_title: req.title,
        feed_url: req.originalUrl,
        updated: new Date().toISOString(),
        user: req.user,
        items: req.items,
        offset: req.offset,
        count: req.count,
        total_count: req.total_count
    });
}



// Display items.
app.get('/items',
    passport.authenticate('pocket', { failureRedirect: '/login' }),
    function(req, res, next) {
        var offset = parseInt(req.query.offset) || 0;
        var count = parseInt(req.query.count) || 100;

        items.find({}).sort({'pocket.time_updated': -1}).skip(offset).limit(count, function(err, resulting_items) {
            items.find({}).count(function(inner_err, total_count) {
                req.title = "All items (from " + offset + " to " + (offset + count) + ")";
                req.items = resulting_items;
                req.offset = offset;
                req.count = count;
                req.total_count = total_count;

                next();
            });
        });
    },
    results_to_html
);

// Display items as an Atom feed.
app.get('/atom/:uuid/items',
    passport.authenticate('pocket', { failureRedirect: '/login' }),
    function(req, res, next) {
        var offset = parseInt(req.query.offset) || 0;
        var count = parseInt(req.query.count) || 100;

        items.find({}).sort({'pocket.time_updated': -1}).skip(offset).limit(count, function(err, resulting_items) {
            items.find({}).count(function(inner_err, total_count) {
                req.title = "All items (from " + offset + " to " + (offset + count) + ")";
                req.items = resulting_items;
                req.offset = offset;
                req.count = count;
                req.total_count = total_count;

                next();
            });
        });
    },
    results_to_atom
);

app.listen(app.get('port'), function() {
    console.log('Node app is running on port', app.get('port'));
});


