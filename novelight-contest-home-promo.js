// Contest home notice is shown only after operator activates enrollment.
(function () {
  'use strict';

  const area = document.getElementById('novelightContestHomePromo');
  const description = document.getElementById(
    'novelightContestHomePromoDescription'
  );
  const link = document.getElementById('novelightContestHomePromoLink');

  if (!area || !description || !link) return;

  async function refresh(client) {
    if (!client || typeof client.rpc !== 'function') return false;

    try {
      const { data, error } = await client.rpc(
        'novelight_public_contest_catalog',
        {
          p_limit: 1,
          p_offset: 0
        }
      );
      if (error || !data?.ok) return false;

      const deadline = Date.parse(data.entry_deadline_at || '');
      const registrationOpen =
        data.contest_status === 'registration' &&
        Number.isFinite(deadline) &&
        Date.now() <= deadline;

      if (registrationOpen) {
        description.textContent =
          '公開10話以上の作品を1作者1作品エントリーできます。10月31日23:59締切。';
        link.textContent = 'エントリーする →';
      } else if (data.contest_status === 'active') {
        description.textContent =
          '11月30日まで開催。読者の読書ポイントで順位が決まります。';
        link.textContent = '参加作品を読む →';
      } else {
        // Do not advertise a contest that is draft, under review or cancelled.
        area.hidden = true;
        return false;
      }

      area.hidden = false;
      return true;
    } catch {
      // Missing migration, maintenance or an interrupted response must never
      // block existing homepage content or falsely advertise enrollment.
      area.hidden = true;
      return false;
    }
  }

  void refresh(typeof client === 'undefined' ? null : client);
})();
