import type { Metadata } from 'next';
import Link from 'next/link';
import LegalLinks from '@/components/LegalLinks';

export const metadata: Metadata = {
  title: '利用規約（下書き） - 物欲王',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <article className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        <p className="text-sm">
          <Link href="/" className="underline underline-offset-2">アプリへ戻る</Link>
        </p>
        <p role="note" className="rounded-md border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          下書き。Sota の確認待ち。確定した利用規約ではありません。
        </p>
        <h1 className="text-2xl font-bold">利用規約（下書き）</h1>
        <p>画面に同意の確認は無く、この文面への同意を利用の条件にしていません。物欲王は、ほしいものの一覧、価格、メモ、写真からの候補を、自分の画面に残すアプリです。</p>

        <h2 className="text-lg font-semibold pt-2">入り方</h2>
        <p>会員はメールアドレスと6文字以上のパスワードで作ります。名前は任意です。Googleログインは、その設定があるときだけ画面に出ます。</p>
        <p>ゲスト体験は、その設定があるときだけ使えます。期限が切れるか体験を終えるとデータを消し、会員のログインには引き継ぎません。</p>

        <h2 className="text-lg font-semibold pt-2">ログアウトと退会</h2>
        <p>会員がログアウトすると、それまでのログインは使えなくなります。</p>
        <p>設定の退会は、アカウントと登録したデータを消します。元に戻す操作はありません。</p>

        <h2 className="text-lg font-semibold pt-2">外へ送るもの</h2>
        <p>商品URLを登録したり価格を取り直したりすると、そのURLのページを取得します。写真から探すと、写真を判定先へ送り、写真自体は保存しません。通知の宛先を保存しているときは、価格の通知をその宛先へ送ることがあります。</p>

        <h2 className="text-lg font-semibold pt-2">支払いと書き出し</h2>
        <p>このアプリの中に、代金を払う機能はありません。</p>
        <p>会員は自分のデータをCSVで書き出せます。設定に出る拡張機能用のトークンは、その会員の画面に表示します。</p>
        <p>下書きの日付は2026-10-23です。</p>
        <LegalLinks />
      </article>
    </main>
  );
}
