const worker = {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get('accept')?.includes('text/html');

    if (response.status !== 404 || request.method !== 'GET' || !acceptsHtml) {
      return response;
    }

    return env.ASSETS.fetch(new Request(new URL('/index.html', request.url)));
  },
};

export default worker;
