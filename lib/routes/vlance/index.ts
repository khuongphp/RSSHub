import * as cheerio from 'cheerio';

import { config } from '@/config';
import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';

// --- Constants ---

const baseUrl = 'https://www.vlance.vn';
const TARGET_ITEMS = 20;
const PAGE_COUNT = 4;

// --- Helpers ---

/** Build vLance job list API URL. Filter format: {cpath} for page 1, {cpath}_page_N for page N (N >= 2). */
function buildListUrl(filter: string) {
    return `${baseUrl}/block/job_list/${filter}?_route_params%5Bfilters%5D=${filter}`;
}

/**
 * Parse job cards from vLance list HTML.
 * Returns items with hasOpenDeadline: true if card contains "Hạn nhận hồ sơ:" (still accepting bids).
 */
function parseCards($: ReturnType<typeof cheerio.load>) {
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

        return {
            title,
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
            description: 'cpath từ URL danh mục vLance. Lấy từ đường dẫn trang category, ví dụ: viec-lam-freelance/cpath_ai-tri-tue-nhan-tao → dùng cpath_ai-tri-tue-nhan-tao',
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
    name: 'Danh mục việc làm',
    maintainers: ['DIYgod'],
    handler,
    url: 'www.vlance.vn',
    description: `::: tip Cách lấy cpath
  Mở trang danh mục việc làm trên vLance, copy phần \`cpath_xxx\` trong URL. Ví dụ: \`https://www.vlance.vn/viec-lam-freelance/cpath_ai-tri-tue-nhan-tao\` → cpath = \`cpath_ai-tri-tue-nhan-tao\`
:::

| Danh mục              | cpath |
| --------------------- | ----- |
| Công việc IT & Lập trình | cpath_cac-cong-viec-it-va-lap-trinh |
| AI Trí tuệ nhân tạo   | cpath_ai-tri-tue-nhan-tao |

Feed ưu tiên 20 job còn hạn nhận hồ sơ, sau đó bổ sung job mới nhất (load 4 trang đầu).`,
};

async function handler(ctx) {
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
        const $ = cheerio.load(html);
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
