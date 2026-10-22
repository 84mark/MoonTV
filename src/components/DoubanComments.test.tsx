import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import DoubanComments from './DoubanComments';

const subject = { id: '1292052', title: '肖申克的救赎', year: '1994' };
const comment = {
  id: '123',
  author: '测试网友',
  text: '<img src=x onerror=alert(1)>',
  rating: 5,
  time: '2008-02-27',
  votes: 12,
};
const reply = (data: unknown, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 502, json: async () => data });
beforeEach(() => {
  global.fetch = jest.fn();
});

it('loads by Douban ID, renders plain text, and appends pages without duplicate comments', async () => {
  (fetch as jest.Mock)
    .mockImplementationOnce(() =>
      reply({ subject, comments: [comment], candidates: [], nextStart: 20 })
    )
    .mockImplementationOnce(() =>
      reply({
        subject,
        comments: [comment, { ...comment, id: '124', text: '第二页短评' }],
        candidates: [],
        nextStart: null,
      })
    );
  const { container } = render(
    <DoubanComments title={subject.title} year='1994' doubanId={subject.id} />
  );
  expect(await screen.findByText(comment.text)).toBeInTheDocument();
  expect(container.querySelector('img')).toBeNull();
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining('id=1292052'),
    expect.anything()
  );
  fireEvent.click(screen.getByText('加载更多短评'));
  expect(await screen.findByText('第二页短评')).toBeInTheDocument();
  expect(screen.getAllByText(comment.text)).toHaveLength(1);
  expect(fetch).toHaveBeenLastCalledWith(
    expect.stringContaining('start=20'),
    expect.anything()
  );
});
it('asks for a film choice on ambiguous results instead of showing unrelated comments', async () => {
  (fetch as jest.Mock)
    .mockImplementationOnce(() =>
      reply({
        subject: null,
        comments: [],
        candidates: [subject],
        nextStart: null,
      })
    )
    .mockImplementationOnce(() =>
      reply({ subject, comments: [comment], candidates: [], nextStart: null })
    );
  render(<DoubanComments title='肖申克' year='' doubanId='' />);
  fireEvent.click(await screen.findByRole('button', { name: /肖申克的救赎/ }));
  expect(await screen.findByText(comment.text)).toBeInTheDocument();
  expect(fetch).toHaveBeenLastCalledWith(
    expect.stringContaining('id=1292052'),
    expect.anything()
  );
});
it('keeps the Douban link on failure and retries without affecting playback', async () => {
  (fetch as jest.Mock)
    .mockImplementationOnce(() => reply({}, false))
    .mockImplementationOnce(() =>
      reply({ subject, comments: [], candidates: [], nextStart: null })
    );
  render(
    <DoubanComments title={subject.title} year='1994' doubanId={subject.id} />
  );
  expect(await screen.findByText(/豆瓣短评暂时无法获取/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /去豆瓣查看/ })).toHaveAttribute(
    'href',
    expect.stringContaining('/1292052/')
  );
  fireEvent.click(screen.getByText('重试'));
  expect(
    await screen.findByText('这部影片暂时没有可展示的短评。')
  ).toBeInTheDocument();
});
it('aborts stale requests when the film changes', async () => {
  let firstSignal: AbortSignal;
  (fetch as jest.Mock)
    .mockImplementationOnce((_url, options) => {
      firstSignal = options.signal;
      return new Promise(() => undefined);
    })
    .mockImplementationOnce(() =>
      reply({
        subject: { ...subject, id: '1292053', title: '其他电影' },
        comments: [],
        candidates: [],
        nextStart: null,
      })
    );
  const { rerender } = render(
    <DoubanComments title={subject.title} year='1994' doubanId={subject.id} />
  );
  rerender(<DoubanComments title='其他电影' year='2026' doubanId='1292053' />);
  await waitFor(() => expect(firstSignal.aborted).toBe(true));
  expect(await screen.findByText(/其他电影/)).toBeInTheDocument();
});
