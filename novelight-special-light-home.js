(() => {
  'use strict';

  const sectionId = 'specialLightGateway';
  if (document.getElementById(sectionId)) return;

  const mount =
    document.getElementById('gatheringShelfSection') ||
    document.getElementById('unseenShelfSection') ||
    document.getElementById('seedShelfSection') ||
    document.getElementById('new-arrivals');
  if (!mount?.parentNode) return;

  const style = document.createElement('style');
  style.id = 'novelight-special-light-home-style';
  style.textContent = `
    .special-light-gateway{padding:54px 22px;background:linear-gradient(180deg,#07111f 0%,#0b1728 100%);border-top:1px solid rgba(214,164,71,.18);border-bottom:1px solid rgba(214,164,71,.18)}
    .special-light-gateway-inner{width:min(1100px,100%);margin:0 auto;padding:34px;border:1px solid rgba(214,164,71,.34);border-radius:22px;background:radial-gradient(circle at 50% 0%,rgba(113,88,170,.18),transparent 56%),rgba(8,20,38,.82);text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.22)}
    .special-light-gateway-kicker{display:block;margin-bottom:8px;color:#d6a447;font-size:12px;font-weight:900;letter-spacing:.18em}
    .special-light-gateway h2{margin:0 0 10px;color:#f7f4ed;font-size:clamp(25px,4vw,36px);line-height:1.35}
    .special-light-gateway p{max-width:720px;margin:0 auto 22px;color:#b8c0cd;font-size:14px;line-height:1.9}
    .special-light-gateway-link{display:inline-flex;min-height:50px;align-items:center;justify-content:center;padding:12px 25px;border:1px solid #d6a447;border-radius:999px;background:#d6a447;color:#07111f!important;font-size:15px;font-weight:900;box-shadow:0 8px 28px rgba(214,164,71,.17);transition:transform .18s ease,box-shadow .18s ease}
    .special-light-gateway-link:hover{transform:translateY(-2px);box-shadow:0 12px 34px rgba(214,164,71,.24)}
    @media(max-width:640px){.special-light-gateway{padding:36px 16px}.special-light-gateway-inner{padding:26px 18px}.special-light-gateway-link{width:100%}}
  `;
  document.head.appendChild(style);

  const section = document.createElement('section');
  section.id = sectionId;
  section.className = 'special-light-gateway';
  section.setAttribute('aria-labelledby', 'specialLightGatewayTitle');
  section.innerHTML = `
    <div class="special-light-gateway-inner">
      <span class="special-light-gateway-kicker">ANOTHER LIGHT</span>
      <h2 id="specialLightGatewayTitle">もうひとつの光を探す</h2>
      <p>AI作品・R15・R18など、通常の発見エリアとは分けて掲載している作品を探せます。</p>
      <a class="special-light-gateway-link" href="special-light.html">光の先を見にいく <span aria-hidden="true">&nbsp;›</span></a>
    </div>
  `;
  mount.insertAdjacentElement('afterend', section);
})();
