import { selection, select } from 'd3-selection';

import { uiIcon } from './icon.js';
import { uiTooltip } from './tooltip.js';


/**
 * UiValidatorStatus
 * This component adds the validator status control to the footer.
 * (was named "issues_info")
 */
export class UiValidatorStatus {

  /**
   * @constructor
   * @param  `context`  Global shared application context
   */
  constructor(context) {
    this.context = context;

    // Create child components
    this.IssuesTooltip = uiTooltip(context).placement('top');
    this.ResolvedTooltip = uiTooltip(context).placement('top');

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.rerender = (() => this.render());  // call render without argument
    this.click = this.click.bind(this);

    // Event listeners
    const validator = context.systems.validator;
    validator.on('validated', this.rerender);
  }


  /**
   * render
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param {d3-selection} $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  render($parent = this.$parent) {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const l10n = context.systems.l10n;
    const storage = context.systems.storage;
    const validator = context.systems.validator;

    // Create/remove wrapper div if necessary
    let $wrap = $parent.selectAll('.issues-info')
      .data([0]);

    const $$wrap = $wrap.enter()
      .append('div')
      .attr('class', 'issues-info');

    // update
    $wrap = $wrap.merge($$wrap);


    // Gather info to display
    const warningsItem = {
      id: 'warnings',
      count: 0,
      iconID: 'rapid-icon-alert',
      tooltip: this.IssuesTooltip
    };

    const resolvedItem = {
      id: 'resolved',
      count: 0,
      iconID: 'rapid-icon-apply',
      tooltip: this.ResolvedTooltip
    };

    const shownItems = [];
    const liveIssues = validator.getIssues({
      what: storage.getItem('validate-what') ?? 'edited',
      where: storage.getItem('validate-where') ?? 'all'
    });
    if (liveIssues.length) {
      warningsItem.count = liveIssues.length;
      shownItems.push(warningsItem);
    }

    if (storage.getItem('validate-what') === 'all') {
      const resolvedIssues = validator.getResolvedIssues();
      if (resolvedIssues.length) {
        resolvedItem.count = resolvedIssues.length;
        shownItems.push(resolvedItem);
      }
    }

    let $chips = $wrap.selectAll('.chip')
      .data(shownItems, d => d.id);

    $chips.exit()
      .remove();

    // enter
    const $$chips = $chips.enter()
      .append('a')
      .attr('class', d => `chip ${d.id}-count`)
      .attr('href', '#')
      .each((d, i, nodes) => {
        const $$chip = select(nodes[i]);

        $$chip
          .on('click', this.click)
          .call(d.tooltip)
          .call(uiIcon(`#${d.iconID}`));

        $$chip
          .append('span')
          .attr('class', 'count');
      });

    // update
    $chips = $chips.merge($$chips);

    $chips
      .each((d, i, nodes) => {
        const $chip = select(nodes[i]);
        $chip
          .select('.count')  // propagate bound data to child
          .text(d => d.count.toString());
      });

    // localize tooltips
    this.IssuesTooltip.title(l10n.t('issues.warnings_and_errors'));
    this.ResolvedTooltip.title(l10n.t('issues.user_resolved_issues'));
  }


  /**
   * click
   * When clicking on a status chip, open the Issues pane
   * @param  {Event} e - event that triggered the click (if any)
   */
  click(e) {
    if (e)  e.preventDefault();

    const context = this.context;
    const ui = context.systems.ui;

    this.IssuesTooltip.hide();
    this.ResolvedTooltip.hide();

    // open the Issues pane
    ui.togglePanes(context.container().select('.map-panes .issues-pane'));
  }

}