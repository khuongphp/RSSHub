import { load } from 'cheerio';
import type { Context } from 'hono';

import { config } from '@/config';
import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Data, Route } from '@/types';
import ofetch from '@/utils/ofetch';

// --- Constants ---

const baseUrl = 'https://www.vlance.vn';
const TARGET_ITEMS = 20;
const PAGE_COUNT = 4;

// --- Helpers ---

/**
 * Parse deadline from card HTML (e.g. "Hạn nhận hồ sơ: X ngày Y giờ", "Còn X ngày Y giờ").
 * Extracts days/hours/minutes (Vietnamese: ngày/giờ/phút), computes deadline = now + duration.
 * Returns date string DD.MM.YY or null if not found/parseable.
 */
function parseDeadlineLabel(cardHtml: string): string | null {
    const match = cardHtml.match(/Hạn nhận hồ sơ[:\s]*((?:\d+\s*(?:ngày|giờ|phút)\s*)+)/i) || cardHtml.match(/Còn\s+((?:\d+\s*(?:ngày|giờ|phút)\s*)+)/i);
    const text = match?.[1]?.trim();
    if (!text) {
        return null;
    }

    let days = 0;
    let hours = 0;
    let minutes = 0;
    const dayMatch = text.match(/(\d+)\s*ngày/i);
    if (dayMatch) {
        days = Number.parseInt(dayMatch[1], 10);
    }
    const hourMatch = text.match(/(\d+)\s*giờ/i);
    if (hourMatch) {
        hours = Number.parseInt(hourMatch[1], 10);
    }
    const minMatch = text.match(/(\d+)\s*phút/i);
    if (minMatch) {
        minutes = Number.parseInt(minMatch[1], 10);
    }

    if (days === 0 && hours === 0 && minutes === 0) {
        return null;
    }

    const deadline = new Date();
    deadline.setDate(deadline.getDate() + days);
    deadline.setHours(deadline.getHours() + hours);
    deadline.setMinutes(deadline.getMinutes() + minutes);

    const d = String(deadline.getDate()).padStart(2, '0');
    const m = String(deadline.getMonth() + 1).padStart(2, '0');
    const y = String(deadline.getFullYear()).slice(-2);
    return `${d}.${m}.${y}`;
}

/** Build vLance job list API URL. Filter format: {cpath} for page 1, {cpath}_page_N for page N (N >= 2). */
function buildListUrl(filter: string) {
    return `${baseUrl}/block/job_list/${filter}?_route_params%5Bfilters%5D=${filter}`;
}

/**
 * Parse job cards from vLance list HTML.
 * hasOpenDeadline: true when card contains "Hạn nhận hồ sơ:" (still accepting bids).
 */
function parseCards($: ReturnType<typeof load>) {
    const cards = $('.row-result')
        .toArray()
        .filter((element) => $(element).find('.fr-name a[href]').length > 0);

    return cards.map((card) => {
        const cardElement = $(card);
        const titleNode = cardElement.find('.fr-name a[href]').first();
        const title = titleNode.text().trim();
        const href = titleNode.attr('href');

        if (!href || !title) {
            return null;
        }

        const link = new URL(href, baseUrl).href;
        const cardHtml = cardElement.html() ?? '';
        const hasOpenDeadline = cardHtml.includes('Hạn nhận hồ sơ:');
        const deadlineLabel = parseDeadlineLabel(cardHtml);

        const author = cardElement.find('.fr-title > a > span').first().text().trim();
        const listCategory = cardElement.find('.fr-summary-desktop .category').first().text().trim();
        const skills = cardElement
            .find('.fr-profile .skill-list a')
            .toArray()
            .map((skill) => $(skill).text().trim())
            .filter(Boolean);

        const category = [...new Set([listCategory, ...skills].filter(Boolean))];
        const descriptionNode = cardElement.find('.fr-service.fr-service-desktop').first().clone();
        descriptionNode.find('.read_more').remove();
        const description = descriptionNode.html()?.trim();

        const displayTitle = deadlineLabel ? `[${deadlineLabel}] ${title}` : title;

        return {
            title: displayTitle,
            link,
            author,
            category,
            description,
            hasOpenDeadline,
        };
    });
}

// --- Route ---

export const route: Route = {
    path: '/:cpath',
    categories: ['other'],
    example: '/vlance/cpath_ai-tri-tue-nhan-tao',
    parameters: {
        cpath: {
            description: 'cpath from vLance category URL. Extract from the category path, e.g. viec-lam-freelance/cpath_ai-tri-tue-nhan-tao → use cpath_ai-tri-tue-nhan-tao',
        },
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        { source: ['www.vlance.vn/viec-lam-freelance/:cpath'], target: '/:cpath' },
        { source: ['www.vlance.vn/tim-viec-lam-freelance'], target: '/cpath_cac-cong-viec-it-va-lap-trinh' },
    ],
    name: 'Job Categories',
    maintainers: ['DIYgod'],
    handler,
    url: 'www.vlance.vn',
    description: `::: tip How to get cpath
  Open a vLance job category page, copy the \`cpath_xxx\` part from the URL. Example: \`https://www.vlance.vn/viec-lam-freelance/cpath_ai-tri-tue-nhan-tao\` → cpath = \`cpath_ai-tri-tue-nhan-tao\`
:::

| Category              | cpath |
| --------------------- | ----- |
| IT & Programming Jobs | cpath_cac-cong-viec-it-va-lap-trinh |
| AI Artificial Intelligence | cpath_ai-tri-tue-nhan-tao |

Feed prioritizes 20 jobs still accepting bids, then fills with newest jobs (loads first 4 pages).`,
};

async function handler(ctx: Context): Promise<Data> {
    const cpath = ctx.req.param('cpath');
    if (!cpath?.trim()) {
        throw new InvalidParameterError('Missing cpath. Example: /vlance/cpath_ai-tri-tue-nhan-tao');
    }

    // Page 1: {cpath}, Page 2–4: {cpath}_page_2, _page_3, _page_4 (no _page_1)
    const filters = [cpath, ...Array.from({ length: PAGE_COUNT - 1 }, (_, i) => `${cpath}_page_${i + 2}`)];

    // Fetch all 4 pages in parallel
    const responses = await Promise.all(
        filters.map((filter) =>
            ofetch(buildListUrl(filter), {
                headers: {
                    'user-agent': config.trueUA,
                    'x-requested-with': 'XMLHttpRequest',
                },
            })
        )
    );

    // Dedupe by link and split: open (still accepting) first, then others
    const seen = new Set<string>();
    const openItems: Array<{ title: string; link: string; author: string; category: string[]; description?: string }> = [];
    const otherItems: Array<{ title: string; link: string; author: string; category: string[]; description?: string }> = [];

    for (const html of responses) {
        const $ = load(html);
        const parsed = parseCards($).filter((p): p is NonNullable<typeof p> => p !== null);

        for (const entry of parsed) {
            if (seen.has(entry.link)) {
                continue;
            }
            seen.add(entry.link);

            const { hasOpenDeadline, ...item } = entry;
            if (hasOpenDeadline) {
                openItems.push(item);
            } else {
                otherItems.push(item);
            }
        }
    }

    // Prioritize open items, fill up to TARGET_ITEMS with remaining (newest-first order preserved)
    const item = [...openItems, ...otherItems].slice(0, TARGET_ITEMS);

    return {
        title: `vLance - ${cpath}`,
        link: `${baseUrl}/viec-lam-freelance/${cpath}`,
        item,
    };
}
