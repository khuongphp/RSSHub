import type { Context } from 'hono';

import type { Data, Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const baseUrl = 'https://chongluadao.vn/blog';
const DEFAULT_LIMIT = 20;

interface WpTerm {
    name: string;
    taxonomy: string;
}

interface WpAuthor {
    name: string;
}

interface WpPost {
    title: {
        rendered: string;
    };
    link: string;
    date_gmt: string;
    content: {
        rendered: string;
    };
    _embedded?: {
        author?: WpAuthor[];
        'wp:term'?: WpTerm[][];
    };
}

function getCategories(post: WpPost): string[] {
    const terms = post._embedded?.['wp:term']?.flat() ?? [];
    return terms.filter((term) => term.taxonomy === 'category').map((term) => term.name);
}

export const route: Route = {
    path: '/blog',
    categories: ['blog'],
    example: '/chongluadao/blog',
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
            source: ['chongluadao.vn/blog'],
            target: '/blog',
        },
    ],
    name: 'Blog',
    maintainers: ['khuongphp'],
    handler,
    url: 'chongluadao.vn/blog',
    description: 'News and articles about online scams and fraud prevention from Chong Lua Dao.',
};

async function handler(ctx: Context): Promise<Data> {
    const limit = Number(ctx.req.query('limit') ?? DEFAULT_LIMIT);

    const posts = await ofetch<WpPost[]>(`${baseUrl}/wp-json/wp/v2/posts`, {
        query: {
            per_page: limit,
            _embed: 'author,wp:term',
        },
    });

    const item = posts.map((post) => ({
        title: post.title.rendered,
        link: post.link,
        description: post.content.rendered,
        pubDate: parseDate(post.date_gmt),
        author: post._embedded?.author?.[0]?.name,
        category: getCategories(post),
    }));

    return {
        title: 'Chong Lua Dao - Blog',
        link: `${baseUrl}/`,
        language: 'vi',
        item,
    };
}
