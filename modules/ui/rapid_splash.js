import { t } from '../core/localizer';
import { uiIntro } from './intro';
import { icon } from './intro/helper';
import { uiModal } from './modal';
import { prefs } from '../core/preferences';


export function uiRapidSplash(context) {

  return function(selection) {
    if (prefs('sawRapidSplash')) return;
    prefs('sawRapidSplash', true);

    const modalSelection = uiModal(selection);

    modalSelection.select('.modal')
      .attr('class', 'modal rapid-modal modal-splash');   // Rapid styling

    let introModal = modalSelection.select('.content');

    introModal
      .append('div')
      .attr('class','modal-section')
      .append('h3').text(t('rapid_splash.welcome'));

    introModal
      .append('div')
      .attr('class','modal-section')
      .append('p')
      .html(t('rapid_splash.text', {
        rapidicon: icon('#rapid-logo-rapid', 'logo-rapid'),
        walkthrough: icon('#rapid-logo-walkthrough', 'logo-walkthrough'),
        edit: icon('#rapid-logo-features', 'logo-features')
      }));

    let buttonWrap = introModal
      .append('div')
      .attr('class', 'modal-actions');

    let walkthrough = buttonWrap
      .append('button')
      .attr('class', 'walkthrough')
      .on('click', () => {
        context.container().call(uiIntro(context, false));
        modalSelection.close();
      });

    walkthrough
      .append('svg')
      .attr('class', 'logo logo-features')
      .append('use')
      .attr('xlink:href', '#rapid-logo-walkthrough');

    walkthrough
      .append('div')
      .text(t('rapid_splash.walkthrough'));

    let rapidWalkthrough = buttonWrap
      .append('button')
      .attr('class', 'rapid-walkthrough')
      .on('click', () => {
        context.container().call(uiIntro(context, true));
        modalSelection.close();
      });

    rapidWalkthrough
      .append('svg')
      .attr('class', 'logo logo-rapid')
      .append('use')
      .attr('xlink:href', '#rapid-logo-rapid');

    rapidWalkthrough
      .append('div')
      .text(t('rapid_splash.skip_to_rapid'));

    let startEditing = buttonWrap
      .append('button')
      .attr('class', 'start-editing')
      .on('click', () => {
        modalSelection.close();
      });

    startEditing
      .append('svg')
      .attr('class', 'logo logo-features')
      .append('use')
      .attr('xlink:href', '#rapid-logo-features');

    startEditing
      .append('div')
      .text(t('rapid_splash.start'));

    modalSelection.select('button.close')
      .attr('class', 'hide');
  };
}
