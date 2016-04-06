# TemplateLevelAuth

A simple package for fine-grained template-level authentication. Executes an "authentication check" function at `onCreated` or `onRendered` and passes the outcome to a "follow up" function to process the outcome. The check-process duo is run reactively with changes in the "reactive dependencies" of "authentication check function".

Have a look at the example app to see how the package works.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [An Extended Example](#an-extended-example)

## Install

This is available as [`convexset:template-level-auth`](https://atmospherejs.com/convexset/template-level-auth) on [Atmosphere](https://atmospherejs.com/). (Install with `meteor add convexset:template-level-auth`.)

## Usage

By way of documentation by example:

```javascript
TemplateLevelAuth.addAuth(
    Template.AdministerUsers,
    {
        authCheck: function getRightsReactively(instance) {
            // get user profile
            var userRecord = UserRecordCollection.findOne({
                userId: Meteor.userId()
            });
            if (!!userRecord && _.isArray(userRecord.rights)) {
                return userRecord.rights;
            } else {
                return [];
            }
        },
        followUp: function processOutcome(instance, rights) {
            // check if rights list contains "ADMINISTER_USERS"
            // route away and/or something if not
            if (rights.indexOf("ADMINISTER_USERS") === -1) {
                MyMessageDisplayer.queue("error", "Unauthorized");
                MyFancyRouter.go("somewhere-else");
            }
        },
        firstCheckOnCreated: true,  // (default: true)
    }
);
```

Noting that authentication checks are run reactively, in the above example, if a user who was originally authorized has rights revoked while on the above template, once MiniMongo is updated, the user will be unceremoniously booted "somewhere-else" via the follow up function.

Since authentication checks may be common across templates, the first parameter may be specified as an array of templates. Also, multiple `addAuth` calls may target the same template.

```javascript
TemplateLevelAuth.addAuth(
    [Template.EditItemDetail, Template.ShowInventoryState],
    {
        authCheck: function getRightsReactively(instance) {
            // may rely a bit more extensively on subscriptions,
            // route params and even instance data (possibly set onCreated,
            // necessitating checking at onRendered)

            var itemId = MyFancyRouter.getParam('itemId');

            var userRecord = UserRecordCollection.findOne({
                userId: Meteor.userId()
            });
            var item = ItemCollection.findOne(itemId);
            
            if (!!userRecord && !!item && (userRecord.managementRights.indexOf(item.category) !== -1)) {
                return {
                    authorized: true
                };
            } else {
                return {
                    authorized: false,
                    managementRights: userRecord.managementRights,
                    itemCategory: item.category
                };
            }
        },
        followUp: function processOutcome(instance, outcome) {
            // route away and/or something if not
            // ... also possibly mutate template instance state
            // ... and template instance state may be used in the authorization
            //     determination
            if (!outcome.authorized) {
                MyMessageDisplayer.queue("error", "Not allowed to manage item.");
                MyFancyRouter.go("somewhere-else");
                instance.isAuthorized.set(true);
            } else {
                instance.isAuthorized.set(false);
            }
        },
        firstCheckOnCreated: false,  // run first check onRendered
    }
);
```

Note that it is intended, in the vast majority of use cases, that when a user is authorized, the "follow up" function does nothing.

## An Extended Example

This example comes from a MVP application and demonstrates intended usage. It is simple syntactic sugar around `TemplateLevelAuth.addAuth`. The example includes a simple `followUp` function which does nothing if authorized/provisionally-allowed-to-stick-around (outcome is `true`) and boots the user to a pre-defined route if definitively unauthorized.

The authentication checks below are a (short-circuited) chain of reactive checks.

 - Actual check (e.g.: is logged in via `!!Meteor.userId()`)
 - Conditions for provisionally allowing the user to stick around, e.g.:
   * is logging in (via: `Meteor.loggingIn()`)
   * subscriptions to publication providing authentication information not yet ready

One might consider evaluating all terms if avoiding short-circuiting is necessary (i.e.: for all reactive deps to be registered on first run) in one's use case. Below, the first term is the actual check, and the later terms are conditions for waiting to "take action".

```javascript
var AUTH_CHECK = {
    IS_LOGGED_IN: function IS_LOGGED_IN() {
        return !!Meteor.userId() || Meteor.loggingIn();
    },
    IS_STAFF: function tla_isStaff() {
        return APlusAuth.currUserHasRight("staff") || Meteor.loggingIn();
    },
    IS_ADMIN: function tla_isAdmin() {
        return APlusAuth.currUserHasRight(APlusAuth.OVERALL_ADMIN_RIGHTS) || Meteor.loggingIn();
    },
    IS_AFFILIATED_TO_COURSE: function tla_hasSomeAccessForCurrentCourse(instance) {
        return APlusViewData.hasSomeAccessForCurrentCourse() || defaultCoursePubNotReadyYet() || Meteor.loggingIn();
    },
    IS_STUDENT_IN_COURSE: function tla_hasStudentAccessInCurrentCourse(instance) {
        return APlusViewData.hasStudentAccessInCurrentCourse() || defaultCoursePubNotReadyYet() || Meteor.loggingIn();
    },
    IS_EDUCATOR_IN_COURSE: function tla_hasEducatorAccessInCurrentCourse(instance) {
        return APlusViewData.hasEducatorAccessInCurrentCourse() || defaultCoursePubNotReadyYet() || Meteor.loggingIn();
    },
    IS_COORDINATOR_IN_COURSE: function tla_hasCoordinatorAccessForCurrentCourse(instance) {
        return APlusViewData.hasCoordinatorAccessForCurrentCourse() || defaultCoursePubNotReadyYet() || Meteor.loggingIn();
    },
    IS_EDUCATOR_OR_COORDINATOR_IN_COURSE: function tla_hasEducatorOrCoordinatorAccessForCurrentCourse(instance) {
        return APlusViewData.hasEducatorOrCoordinatorAccessForCurrentCourse() || defaultCoursePubNotReadyYet() || Meteor.loggingIn();
    },
};

function imposeTemplateLevelAuth(tmplNames, options = {}) {
    options = _.extend({
        authenticationCheck: AUTH_CHECK.IS_LOGGED_IN,
        unauthorizedMessage: null,
        redirectRouteName: 'dashboard',
        firstCheckOnCreated: true
    }, options);

    if (!_.isFunction(options.authenticationCheck)) {
        throw new Meteor.Error('invalid-auth-check');
    }

    if (!_.isArray(tmplNames)) {
        tmplNames = [tmplNames];
    }

    if (Meteor.isClient) {
        TemplateLevelAuth.addAuth(
            tmplNames.map(name => Template[name]), {
                authCheck: options.authenticationCheck,
                followUp: function processOutcome(instance, authorized) {
                    if (!authorized) {
                        if (typeof options.unauthorizedMessage === "string") {
                            sAlertQueue.enqueue('error', options.unauthorizedMessage);
                        }
                        setTimeout(function() {
                            FlowRouter.go(FlowRouter.path(options.redirectRouteName));  
                        }, 0);
                    }
                },
                firstCheckOnCreated: options.firstCheckOnCreated,
            }
        );
    }
}
```

... and this is used as follows:
```javascript
imposeTemplateLevelAuth("ViewNotes", {
    authenticationCheck: AUTH_CHECK.IS_AFFILIATED_TO_COURSE,
    unauthorizedMessage: "Unauthorized: Not affiliated to course.",
});

imposeTemplateLevelAuth("EditNotes", {
    authenticationCheck: AUTH_CHECK.IS_EDUCATOR_OR_COORDINATOR_IN_COURSE,
    unauthorizedMessage: "Unauthorized: No instructor access in course.",
});
```