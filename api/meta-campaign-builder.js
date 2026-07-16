const DEFAULT_VERSION = 'v25.0';
const DEFAULT_SOURCE_CAMPAIGN_ID = '120246944719140105';

function authorized(req) {
  const user = process.env.ADMIN_PANEL_USER;
  const password = process.env.ADMIN_PANEL_PASSWORD;
  if (!user || !password) return false;
  return req.headers['x-admin-user'] === user && req.headers['x-admin-password'] === password;
}

function adsToken() {
  return process.env.META_ADS_ACCESS_TOKEN || process.env.META_MARKETING_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
}

function graphVersion() {
  const version = String(process.env.META_GRAPH_VERSION || DEFAULT_VERSION).trim();
  return version.startsWith('v') ? version : `v${version}`;
}

function normalizeAccountId(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  return clean.startsWith('act_') ? clean : `act_${clean}`;
}

function configured() {
  return Boolean(process.env.META_AD_ACCOUNT_ID && adsToken() && process.env.META_PIXEL_ID);
}

async function metaRequest(path, params = {}, method = 'GET') {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path}`);
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (method === 'GET') url.searchParams.set(key, String(value));
    else body.set(key, String(value));
  });
  if (method === 'GET') url.searchParams.set('access_token', adsToken());
  else body.set('access_token', adsToken());

  const res = await fetch(url.toString(), {
    method,
    headers: method === 'GET'
      ? { Accept: 'application/json' }
      : { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = new Error(data?.error?.message || 'Erro na Meta Marketing API.');
    err.status = res.status || 502;
    err.meta = data?.error;
    throw err;
  }
  return data;
}

function cleanTargeting(targeting = {}) {
  const copy = JSON.parse(JSON.stringify(targeting || {}));
  delete copy.targeting_sentence_lines;
  delete copy.effective_publisher_platforms;
  if (Array.isArray(copy.instagram_positions)
    && copy.instagram_positions.includes('explore_home')
    && !copy.instagram_positions.includes('explore')) {
    copy.instagram_positions.push('explore');
  }
  return copy;
}

function fallbackTargeting() {
  return {
    age_min: 27,
    age_max: 55,
    genders: [1],
    geo_locations: { countries: ['BR'] },
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: ['feed', 'video_feeds', 'facebook_reels', 'story'],
    instagram_positions: ['stream', 'story', 'reels'],
    device_platforms: ['mobile'],
  };
}

function checkoutUrl(kit = 2) {
  return `${checkoutBaseUrl(kit)}&${checkoutUrlTags()}`;
}

function checkoutBaseUrl(kit = 2) {
  const params = new URLSearchParams({
    kit: String(kit),
  });
  return `https://www.duralibid.com.br/checkout.html?${params.toString()}`;
}

function checkoutUrlTags() {
  return 'utm_source=fb&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}';
}

function updateCallToAction(callToAction, link) {
  if (!callToAction?.type) return { type: 'LEARN_MORE', value: { link } };
  return {
    ...callToAction,
    value: {
      ...(callToAction.value || {}),
      link,
    },
  };
}

function cloneObjectStorySpec(spec, link) {
  if (!spec || typeof spec !== 'object') return null;
  const cloned = JSON.parse(JSON.stringify(spec));
  if (cloned.link_data) {
    cloned.link_data.link = link;
    cloned.link_data.call_to_action = updateCallToAction(cloned.link_data.call_to_action, link);
    return cloned;
  }
  if (cloned.video_data?.call_to_action) {
    cloned.video_data.call_to_action = updateCallToAction(cloned.video_data.call_to_action, link);
    return cloned;
  }
  return cloned;
}

function pageIdFromAd(ad) {
  const spec = ad.creative?.object_story_spec || {};
  if (spec.page_id) return String(spec.page_id);
  const storyId = ad.creative?.object_story_id || ad.creative?.effective_object_story_id || '';
  return String(storyId).includes('_') ? String(storyId).split('_')[0] : '';
}

function minimalObjectStorySpec(ad) {
  const pageId = pageIdFromAd(ad);
  return pageId ? { page_id: pageId } : null;
}

function removeProfileRefs(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    value.forEach(removeProfileRefs);
    return value;
  }
  [
    'instagram_actor_id',
    'instagram_user_id',
    'instagram_story_id',
    'source_instagram_media_id',
    'effective_instagram_story_id',
  ].forEach((key) => delete value[key]);
  Object.values(value).forEach(removeProfileRefs);
  return value;
}

function cloneAssetFeedSpec(assetFeed, link) {
  if (!assetFeed || typeof assetFeed !== 'object') return null;
  const cloned = removeProfileRefs(JSON.parse(JSON.stringify(assetFeed)));
  const linkUrls = Array.isArray(cloned.link_urls) && cloned.link_urls.length
    ? cloned.link_urls
    : [{}];
  cloned.link_urls = linkUrls.map((item) => ({
    ...item,
    website_url: link,
    display_url: 'duralibid.com.br',
  }));
  if (!Array.isArray(cloned.call_to_action_types) || !cloned.call_to_action_types.length) {
    cloned.call_to_action_types = ['LEARN_MORE'];
  }
  return cloned;
}

function summarizeAd(ad) {
  const spec = ad.creative?.object_story_spec || {};
  const assetFeed = ad.creative?.asset_feed_spec || {};
  const link = spec.link_data?.link
    || spec.video_data?.call_to_action?.value?.link
    || ad.creative?.object_url
    || assetFeed.link_urls?.[0]?.website_url
    || assetFeed.link_urls?.[0]?.display_url
    || '';
  return {
    id: ad.id,
    name: ad.name,
    status: ad.status,
    effective_status: ad.effective_status,
    creative_id: ad.creative?.id,
    creative_name: ad.creative?.name,
    has_link_data: Boolean(spec.link_data),
    has_asset_feed: Boolean(ad.creative?.asset_feed_spec),
    object_story_id: ad.creative?.object_story_id || ad.creative?.effective_object_story_id || '',
    image_hash: spec.link_data?.image_hash || assetFeed.images?.[0]?.hash || '',
    link,
    body: spec.link_data?.message
      || spec.video_data?.message
      || assetFeed.bodies?.[0]?.text
      || '',
    title: spec.link_data?.name || assetFeed.titles?.[0]?.text || '',
  };
}

async function loadSource(sourceCampaignId) {
  const campaign = await metaRequest(sourceCampaignId, {
    fields: 'id,name,objective,status,effective_status,buying_type,special_ad_categories',
  });
  const adsetsData = await metaRequest(`${sourceCampaignId}/adsets`, {
    fields: [
      'id',
      'name',
      'status',
      'effective_status',
      'targeting',
      'daily_budget',
      'lifetime_budget',
      'bid_strategy',
      'attribution_spec',
      'billing_event',
      'optimization_goal',
      'promoted_object',
    ].join(','),
    limit: 25,
  });
  const adsData = await metaRequest(`${sourceCampaignId}/ads`, {
    fields: [
      'id',
      'name',
      'status',
      'effective_status',
      'adset_id',
      'creative{id,name,object_story_spec,asset_feed_spec,object_story_id,effective_object_story_id,thumbnail_url,object_url,url_tags}',
    ].join(','),
    limit: 50,
  });

  return {
    campaign,
    adsets: adsetsData.data || [],
    ads: adsData.data || [],
  };
}

async function createCampaign({ name, sourceCampaignId, dailyBudget = 20, kit = 2 }) {
  const account = normalizeAccountId(process.env.META_AD_ACCOUNT_ID);
  const source = await loadSource(sourceCampaignId);
  const sourceAdset = source.adsets.find((item) => item.effective_status === 'ACTIVE')
    || source.adsets[0]
    || {};
  const sourceAds = source.ads.filter((ad) => ad.status === 'ACTIVE' && ad.effective_status !== 'DISAPPROVED');
  const adsToClone = sourceAds.length ? sourceAds : source.ads.slice(0, 2);
  const targetUrl = checkoutUrl(kit);
  const campaignName = name || `DURALIBID - TESTE LEAD - C1 - ${new Date().toISOString().slice(0, 10)}`;

  const campaign = await metaRequest(`${account}/campaigns`, {
    name: campaignName,
    objective: 'OUTCOME_LEADS',
    status: 'PAUSED',
    buying_type: 'AUCTION',
    is_adset_budget_sharing_enabled: 'false',
    special_ad_categories: JSON.stringify([]),
  }, 'POST');

  let adset;
  try {
    adset = await metaRequest(`${account}/adsets`, {
      name: `${campaignName} | Checkout kit ${kit}`,
      campaign_id: campaign.id,
      daily_budget: String(Math.max(1, Number(dailyBudget)) * 100),
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'OFFSITE_CONVERSIONS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      destination_type: 'WEBSITE',
      promoted_object: JSON.stringify({
        pixel_id: process.env.META_PIXEL_ID,
        custom_event_type: 'LEAD',
      }),
      targeting: JSON.stringify(cleanTargeting(sourceAdset.targeting) || fallbackTargeting()),
      attribution_spec: JSON.stringify([
        { event_type: 'CLICK_THROUGH', window_days: 7 },
        { event_type: 'VIEW_THROUGH', window_days: 1 },
      ]),
      status: 'PAUSED',
    }, 'POST');
  } catch (err) {
    await metaRequest(campaign.id, { status: 'PAUSED' }, 'POST').catch(() => {});
    throw err;
  }

  const createdAds = [];
  for (const ad of adsToClone) {
    const spec = cloneObjectStorySpec(ad.creative?.object_story_spec, targetUrl);
    const assetFeedSpec = cloneAssetFeedSpec(ad.creative?.asset_feed_spec, targetUrl);
    let creativeId = ad.creative?.id;
    if (assetFeedSpec) {
      const creativePayload = {
        name: `${campaignName} | ${ad.name}`,
        asset_feed_spec: JSON.stringify(assetFeedSpec),
      };
      const storySpec = minimalObjectStorySpec(ad) || spec;
      if (storySpec) creativePayload.object_story_spec = JSON.stringify(storySpec);
      const creative = await metaRequest(`${account}/adcreatives`, creativePayload, 'POST');
      creativeId = creative.id;
    } else if (spec?.link_data || spec?.video_data) {
      const creative = await metaRequest(`${account}/adcreatives`, {
        name: `${campaignName} | ${ad.name}`,
        object_story_spec: JSON.stringify(spec),
      }, 'POST');
      creativeId = creative.id;
    }
    if (!creativeId) continue;
    const createdAd = await metaRequest(`${account}/ads`, {
      name: `${ad.name} | Lead checkout kit ${kit}`,
      adset_id: adset.id,
      creative: JSON.stringify({ creative_id: creativeId }),
      status: 'PAUSED',
    }, 'POST');
    createdAds.push({
      id: createdAd.id,
      name: `${ad.name} | Lead checkout kit ${kit}`,
      source_ad_id: ad.id,
      creative_id: creativeId,
    });
  }

  return {
    campaign: { id: campaign.id, name: campaignName, status: 'PAUSED', objective: 'OUTCOME_LEADS' },
    adset: { id: adset.id, name: `${campaignName} | Checkout kit ${kit}`, status: 'PAUSED', event: 'LEAD' },
    ads: createdAds,
    source: {
      campaign: source.campaign,
      adset: {
        id: sourceAdset.id,
        name: sourceAdset.name,
        optimization_goal: sourceAdset.optimization_goal,
      },
      ads: adsToClone.map(summarizeAd),
    },
    destination_url: targetUrl,
  };
}

async function copyAdsToAdset({ sourceCampaignId, targetAdsetId, kit = 2, limit = 3 }) {
  const source = await loadSource(sourceCampaignId);
  const sourceAds = source.ads.filter((ad) => ad.status === 'ACTIVE' && ad.effective_status !== 'DISAPPROVED');
  const adsToCopy = (sourceAds.length ? sourceAds : source.ads).slice(0, Math.max(1, Number(limit) || 3));
  const copiedAds = [];
  const failures = [];
  const linkUrl = checkoutBaseUrl(kit);
  const urlTags = checkoutUrlTags();

  for (const ad of adsToCopy) {
    try {
      const copied = await metaRequest(`${ad.id}/copies`, {
        adset_id: targetAdsetId,
        status: 'PAUSED',
        creative_parameters: JSON.stringify({
          link_url: linkUrl,
          url_tags: urlTags,
        }),
      }, 'POST');
      copiedAds.push({
        source_ad_id: ad.id,
        source_name: ad.name,
        copied_ad_id: copied.copied_ad_id || copied.id || '',
        meta: copied,
      });
    } catch (err) {
      failures.push({
        source_ad_id: ad.id,
        source_name: ad.name,
        error: err.message,
        meta: err.meta,
      });
    }
  }

  return {
    source: {
      campaign: source.campaign,
      ads: adsToCopy.map(summarizeAd),
    },
    target_adset_id: targetAdsetId,
    destination_url: `${linkUrl}&${urlTags}`,
    copied_ads: copiedAds,
    failures,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-User, X-Admin-Password');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ADMIN_PANEL_USER || !process.env.ADMIN_PANEL_PASSWORD) {
    return res.status(503).json({ error: 'ADMIN_PANEL_USER ou ADMIN_PANEL_PASSWORD nao configurada.' });
  }
  if (!authorized(req)) return res.status(401).json({ error: 'Usuario ou senha invalido.' });
  if (!configured()) {
    return res.status(503).json({ error: 'META_AD_ACCOUNT_ID, META_PIXEL_ID ou META_ADS_ACCESS_TOKEN nao configurada.' });
  }

  try {
    const sourceCampaignId = req.method === 'GET'
      ? (req.query?.source_campaign_id || DEFAULT_SOURCE_CAMPAIGN_ID)
      : (req.body?.source_campaign_id || DEFAULT_SOURCE_CAMPAIGN_ID);

    if (req.method === 'GET') {
      const source = await loadSource(sourceCampaignId);
      return res.status(200).json({
        graph_version: graphVersion(),
        source_campaign_id: sourceCampaignId,
        campaign: source.campaign,
        adsets: source.adsets.map((adset) => ({
          id: adset.id,
          name: adset.name,
          status: adset.status,
          effective_status: adset.effective_status,
          optimization_goal: adset.optimization_goal,
          billing_event: adset.billing_event,
          daily_budget: adset.daily_budget ? Number(adset.daily_budget) / 100 : null,
          targeting: adset.targeting,
        })),
        ads: source.ads.map(summarizeAd),
      });
    }

    if (req.body?.target_adset_id) {
      const result = await copyAdsToAdset({
        sourceCampaignId,
        targetAdsetId: req.body.target_adset_id,
        kit: req.body?.kit || 2,
        limit: req.body?.limit || 3,
      });
      return res.status(200).json({ ok: result.copied_ads.length > 0, ...result });
    }

    const result = await createCampaign({
      sourceCampaignId,
      name: req.body?.name,
      dailyBudget: req.body?.daily_budget || 20,
      kit: req.body?.kit || 2,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('Meta campaign builder error:', err.meta || err.message);
    return res.status(err.status || 502).json({
      error: err.message || 'Erro ao criar campanha Meta Ads.',
      meta: err.meta,
    });
  }
}
