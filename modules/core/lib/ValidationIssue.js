import { Extent } from '@rapid-sdk/math';

import { ValidationFix } from './ValidationFix';
import { utilTotalExtent } from '../../util';


export class ValidationIssue {

  constructor(context, props) {
    this.context = context;

    this.type = props.type;                  // required - name of rule that created the issue (e.g. 'missing_tag')
    this.subtype = props.subtype;            // optional - category of the issue within the type (e.g. 'relation_type' under 'missing_tag')
    this.severity = props.severity;          // required - 'warning' or 'error'
    this.message = props.message;            // required - function returning localized string
    this.reference = props.reference;        // optional - function(selection) to render reference information
    this.entityIds = props.entityIds;        // optional - array of IDs of entities involved in the issue
    this.loc = props.loc;                    // optional - [lon, lat] to zoom in on to see the issue
    this.data = props.data;                  // optional - object containing extra data for the fixes
    this.dynamicFixes = props.dynamicFixes;  // optional - function(context) returning fixes
    this.hash = props.hash;                  // optional - string to further differentiate the issue

    this.id = this._generateID();            // generated - see below
    this.key = this._generateKey();          // generated - see below (call after generating this.id)
    this.autoArgs = props.autoArgs;          // optional - if this issue can be autofixed, supply the autofix args at issue creation
    this.autoFix = null;                     // generated - if autofix exists, will be set below
  }


  extent(resolver) {
    if (this.loc) {
      return new Extent(this.loc);
    }
    if (this.entityIds && this.entityIds.length) {
      return utilTotalExtent(this.entityIds, resolver);
    }
    return null;
  }


  fixes() {
    // sometimes the fixes are generated dynamically
    let fixes = (typeof this.dynamicFixes === 'function') ? this.dynamicFixes() : [];

    // For warnings, create an "ignore" option
    if (this.severity === 'warning') {
      fixes.push(new ValidationFix({
        title: this.context.tHtml('issues.fix.ignore_issue.title'),
        icon: 'rapid-icon-close',
        onClick: () => {
          this.context.systems.validator.ignoreIssue(this.id);
        }
      }));
    }

    for (const fix of fixes) {
      fix.id = fix.title;   // the id doesn't matter as long as it's unique to this issue/fix
      fix.issue = this;     // add a reference back to this issue for use in actions
//      if (fix.autoArgs) {
//        this.autoFix = fix;
//    }
    }
    return fixes;
  }


  // A unique, deterministic string hash.
  // Issues with identical id values are considered identical.
  _generateID() {
    let parts = [this.type];

    if (this.hash) {   // subclasses can pass in their own differentiator
      parts.push(this.hash);
    }

    if (this.subtype) {
      parts.push(this.subtype);
    }

    // include the entities this issue is for
    // (sort them so the id is deterministic)
    if (this.entityIds) {
      const entityKeys = this.entityIds.slice().sort();
      parts.push.apply(parts, entityKeys);
    }

    return parts.join(':');
  }


  // An identifier suitable for use as the second argument to d3.selection#data().
  // (i.e. this should change whenever the data needs to be refreshed)
  _generateKey() {
    return this.id + ':' + Date.now().toString();  // include time of creation
  }
}
