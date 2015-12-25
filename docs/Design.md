Design for pull-data-to-cloud apps
==================================

Since I have at least two apps planned with this design model, I think
it makes sense for me to write down how these sorts of websites should do.

The reason for this design is that just about all cloud providers have
a low-powered free option and just about all data providers have an
API key-based access system. Theoretically, we could run a very simple
data-pull query system entirely off of API calls, but in many cases
those APIs don't allow you to make all the requests you need. You may
also need to combine data from multiple providers.

At its highest level, this architecture consists of:
 1. *Source*: The database(s) we curate/build up/improve.
 2. *Database*: A database that stores the combined data used by the application. 
    If this can be squeezed in a free plan, great; if not, the goal would be to
    make sure that this is the most expensive part of the entire system. This is
    also the trickiest piece to get right: we either need to abstract all the
    necessary data from all sources, or have a system that allows incoming data
    to be indexed as necessary. A NoSQL database might be ideal in that regard.
 3. *Frontend*: A small, cheap application that routes calls to a database to retrieve 
    data in different ways.
    The frontend consists of:
      1. *Controller*: Should be extremely extensible: most of my work will
      be to add new ways of retrieving and visualizing the data in the controller.
      2. *Model*: A standardized library for accessing the database would be great,
      as that would allow the controller to be much clearer.
      3. *Loader*: Make queries against the source and store it in the database.
 4. *Import*: A set of scripts that inserts external data into the database.
  
