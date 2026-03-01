import * as cheerio from 'cheerio';

import { config } from '@/config';
import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';

const baseUrl = 'https://www.vlance.vn';
const listUrl = `${baseUrl}/block/job_list/cpath_cac-cong-viec-it-va-lap-trinh?_route_params%5Bfilters%5D=cpath_cac-cong-viec-it-va-lap-trinh`;

export const route: Route = {
    path: '/it',
    categories: ['other'],
    example: '/vlance/it',
    parameters: {},
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['www.vlance.vn/tim-viec-lam-freelance'],
            target: '/it',
        },
    ],
    name: 'Công việc IT & Lập trình',
    maintainers: ['DIYgod'],
    handler,
    url: 'www.vlance.vn/tim-viec-lam-freelance',
};

async function handler() {
    const response = await ofetch(listUrl, {
        headers: {
            'user-agent': config.trueUA,
            'x-requested-with': 'XMLHttpRequest',
        },
    });
    const $ = cheerio.load(response);

    const cards = $('.row-result')
        .toArray()
        .filter((element) => $(element).find('.fr-name a[href]').length > 0);

    const item = cards
        .map((card) => {
            const cardElement = $(card);
            const titleNode = cardElement.find('.fr-name a[href]').first();
            const title = titleNode.text().trim();
            const href = titleNode.attr('href');

            if (!href || !title) {
                return;
            }

            const link = new URL(href, baseUrl).href;
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
            };
        })
        .filter((entry) => entry !== undefined);

    return {
        title: 'vLance - Công việc IT & Lập trình',
        link: `${baseUrl}/tim-viec-lam-freelance`,
        item,
    };
}
