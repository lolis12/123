/**
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

var firebase = require('firebase');
var nodemailer = require('nodemailer');
var schedule = require('node-schedule');
var Promise = require('promise');
var escape = require('escape-html');
var express = require('express');
var app = express();
var serverStartTime = Math.floor(new Date() / 1);

// Configure the email transport using the default SMTP transport and a GMail account.
// See: https://nodemailer.com/
// For other types of transports (Amazon SES, Sendgrid...) see https://nodemailer.com/2-0-0-beta/setup-transporter/
var mailTransport = nodemailer.createTransport('smtps://'+process.env.GMAIL_USERNAME+'%40gmail.com:'+process.env.GMAIL_PASSWORD+'@smtp.gmail.com');

// [START initialize]
// Initialize the app with a service account, granting admin privileges
firebase.initializeApp({
  databaseURL: 'https://'+process.env.PROJECT_ID+'.firebaseio.com',
  serviceAccount: {
    projectId: process.env.PROJECT_ID,
    clientEmail: process.env.CLIENT_EMAIL,
    privateKey: process.env.PRIVATE_KEY
  }
});
// [END initialize]

// Set our simple Express server to serve up our front-end files
// http://expressjs.com/en/starter/static-files.html
app.use(express.static('public'));
// http://expressjs.com/en/starter/basic-routing.html
app.get("/", function (request, response) {
  response.sendFile(__dirname + '/public/index.html');
});

// Save the date at which we last tried to send a notification
function updateNotification(uid, postId){
  var update = {};
  update['/posts/' + postId + '/lastNotificationTimestamp'] =
    firebase.database.ServerValue.TIMESTAMP;
  update['/user-posts/' + uid + '/' + postId + '/lastNotificationTimestamp'] =
    firebase.database.ServerValue.TIMESTAMP;
  firebase.database().ref().update(update);
}

/**
 * Send a new star notification email to the user with the given UID.
 */
// [START single_value_read]
function sendNotificationToUser(uid, postId) {
  // Fetch the user's email.
  var userRef = firebase.database().ref('/users/' + uid);
  userRef.once('value').then(function(snapshot) {
    var email = snapshot.val().email;
    var postRef = firebase.database().ref('/posts/' + postId);
    postRef.once('value').then(function(thepost) {
      if(!thepost.val().lastNotificationTimestamp || thepost.val().lastNotificationTimestamp>serverStartTime){ // Stop notifications for old stars
        // Send the email to the user.
        if (email) {
          sendNotificationEmail(email).then(function() {
            updateNotification(uid, postId);
          }, function(reason) { // Email send failure
            console.log(reason); // Error
        });
        }
      } else {
        updateNotification(uid, postId);
      }
    });
  }).catch(function(error) {
    console.log('Failed to send notification to user:', error);
  });
}
// [END single_value_read]


/**
 * Send the new star notification email to the given email.
 */
function sendNotificationEmail(email) {
  var mailOptions = {
    from: '"Firebase Database Quickstart" <noreply@firebase.com>',
    to: email,
    subject: 'New star!',
    text: 'One of your posts has received a new star!'
  };
  return mailTransport.sendMail(mailOptions).then(function() {
    console.log('New star email notification sent to: ' + email);
  });
}

/**
 * Update the star count.
 */
// [START post_stars_transaction]
function updateStarCount(postRef) {
  postRef.transaction(function(post) {
    if (post) {
      post.starCount = post.stars ? Object.keys(post.stars).length : 0;
    }
    return post;
  });
}
// [END post_stars_transaction]

/**
 * Keep the likes count updated and send email notifications for new likes.
 */
function startListeners() {
  firebase.database().ref('/posts').on('child_added', function(postSnapshot) {
    var postReference = postSnapshot.ref;
    var uid = postSnapshot.val().uid;
    var postId = postSnapshot.key;
    // Update the star count.
    // [START post_value_event_listener]
    postReference.child('stars').on('value', function(dataSnapshot) {
      updateStarCount(postReference);
      // [START_EXCLUDE]
      updateStarCount(firebase.database().ref('user-posts/' + uid + '/' + postId));
      // [END_EXCLUDE]
    }, function(error) {
      console.log('Failed to add "value" listener at /posts/' + postId + '/stars node:', error);
    });
    // [END post_value_event_listener]
    // Send email to author when a new star is received.
    // [START child_event_listener_recycler]
    postReference.child('stars').on('child_added', function(dataSnapshot) {
      sendNotificationToUser(uid, postId);
    }, function(error) {
      console.log('Failed to add "child_added" listener at /posts/' + postId + '/stars node:', error);
    });
    // [END child_event_listener_recycler]
  });
  console.log('New star notifier started...');
  console.log('Likes count updater started...');
}

// Start the Firebase server
startListeners();

// Listen for HTTP requests
var listener = app.listen(process.env.PORT, function () {
  console.log('Your app is listening on port ' + listener.address().port);
});