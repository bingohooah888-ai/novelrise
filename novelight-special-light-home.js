(function () {
  'use strict';

  const SECTION_ID = 'specialLightDiscovery';

  function mount() {
    if (document.getElementById(SECTION_ID)) return;
    const anchor = document.getElementById('gatheringShelfSection');
    if (!anchor?.parentNode) return;

    const style = document.createElement('style');
    style.textContent = `
      .special-light-home{padding:54px 0;background:linear-gradient(180deg,rgba(6,16,29,.98),rgba(9,19,34,.98))}
      .special-light-home-card{display:flex;align-items:center;justify-content:space-between;gap:28px;padding:28px 30px;border:1px solid rgba(214,164,71,.3);border-radius:18px;background:linear-gradient(135deg,rgba(17,27,44,.96),rgba(7,16,29,.98));box-shadow:0 18px 48px rgba(0,0,0,.2)}
      .special-light-home-copy{max-width:760px}.special-light-home-kicker{display:block;margin-bottom:5px;color:#d6a447;font-size:.72rem;font-weight:900;letter-spacing:.18em}.special-light-home h2{margin:0 0 8px;font-size:clamp(1.45rem,3vw,2rem)}.special-light-home p{margin:0;color:#aeb7c4}.special-light-home-link{display:inline-flex;min-width:320px;min-height:96px;align-items:center;justify-content:center;flex:0 0 auto;padding:24px 40px;border-radius:14px;background:#d6a447;color:#081426;font-size:1.35rem;font-weight:900;line-height:1.15;letter-spacing:.02em;white-space:nowrap}
      @media(max-width:720px){.special-light-home{padding:38px 0}.special-light-home-card{align-items:stretch;flex-direction:column;padding:24px}.special-light-home-link{width:100%;min-width:0;min-height:72px;padding:18px 24px;font-size:clamp(1.15rem,5vw,1.35rem)}}
    `;
    document.head.appendChild(style);

    const section = document.createElement('section');
    section.id = SECTION_ID;
    section.className = 'special-light-home';
    section.innerHTML = `
      <div class="container">
        <div class="special-light-home-card">
          <div class="special-light-home-copy">
            <span class="special-light-home-kicker">ANOTHER LIGHT</span>
            <h2>もうひとつの光を探す</h2>
            <p>AI作品・R15・R18など、通常の発見エリアとは分けて掲載している作品を探せます。</p>
          </div>
          <a class="special-light-home-link" href="special-light.html">光を探しに行く <span aria-hidden="true">›</span></a>
        </div>
      </div>`;

    anchor.insertAdjacentElement('afterend', section);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
