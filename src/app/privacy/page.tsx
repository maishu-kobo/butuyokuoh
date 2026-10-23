import type { Metadata } from 'next';
import Link from 'next/link';
import LegalLinks from '@/components/LegalLinks';

export const metadata: Metadata = {
  title: 'プライバシーポリシー（下書き） - 物欲王',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <article className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        <p className="text-sm">
          <Link href="/" className="underline underline-offset-2">アプリへ戻る</Link>
        </p>
        <p role="note" className="rounded-md border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          下書き。Sota の確認待ち。確定したプライバシーポリシーではありません。
        </p>
        <h1 className="text-2xl font-bold">プライバシーポリシー（下書き）</h1>
        <p>この文は、いまの物欲王がしていることの説明です。法律上の同意文や、法令への適合の宣言ではありません。</p>

        <h2 className="text-lg font-semibold pt-2">アカウント</h2>
        <p>メールアドレスとパスワードで会員を作れます。パスワードは6文字以上です。保存するのは照合用のハッシュで、入力したパスワードそのものではありません。名前は任意です。確認メールは送りません。</p>
        <p>Googleログインは、その設定があるときだけ画面に出ます。使うときは、確認済みのGoogleアカウントのメールアドレス、名前、Googleの識別子を会員に結びつけます。同じメールの会員に結ぶと、その会員のパスワードは消します。</p>

        <h2 className="text-lg font-semibold pt-2">ほしいもの</h2>
        <p>商品名、URL、店舗の画像URL、価格、メモ、優先度、個数、購入予定日、購入済み、カテゴリ、比較グループを、このアプリが動いている場所のSQLiteに保存します。</p>
        <p>商品の価格を取りに行くときは、その商品URLのページを取得します。価格が変わったときは履歴に残します。まとめて行う価格の確認は、会員の未購入で、ゴミ箱に無く、商品コードが無く、写真の比較グループに入っていない商品が対象です。保存したSlackまたはDiscordのウェブフックがあり、通知がオンのときは、その宛先へ価格の通知を送ることがあります。</p>

        <h2 className="text-lg font-semibold pt-2">画像と写真</h2>
        <p>会員がアップロードした画像は、位置情報などの付随データを落としてから保存します。退会すると、その会員のアップロードファイルも消します。</p>
        <p>写真から商品を判定するときは、写真をCloudflareのWorkers AI（api.cloudflare.com）へ送ります。写真そのものはこのアプリのデータベースに保存しません。残すのは、推定した商品名、JAN、判定回数の記録です。検索で見つけた候補は30分で消します。候補の画像URLは店舗の商品画像です。</p>
        <p>商品名から候補を探すとき、設定がある店の検索へ検索語を送ります。いまのアプリでは、Yahoo!ショッピング（shopping.yahooapis.jp）と楽天市場（openapi.rakuten.co.jp）です。キーが無い店は使いません。URLから商品を追加したり、価格を取り直したりするときは、そのURLのページを取得します。</p>

        <h2 className="text-lg font-semibold pt-2">ゲスト</h2>
        <p>ゲスト体験は、その設定があるときだけ使えます。メールアドレスは受け取りません。体験用の行には、利用者が入力していない仮の識別子を付けます。期限の標準は24時間で、設定で変わります。期限が切れるか体験を終えると、ゲストのデータを消します。会員のログインには引き継ぎません。開始時にサンプルの商品を入れます。</p>

        <h2 className="text-lg font-semibold pt-2">クッキーとブラウザ</h2>
        <p>メールとパスワードのログインは、クッキー butuyokuoh_token に会員ID、メールアドレス、ログインの世代を入れます。httpOnly、SameSite=Lax、有効期限は7日です。本番ではSecureを付けます。</p>
        <p>ゲストはクッキー butuyokuoh_guest です。httpOnly、SameSite=Laxで、体験の期限までです。サーバに残すのはトークンのハッシュです。</p>
        <p>Googleログインのあいだは、ログイン状態を保つ別のクッキーをブラウザに置きます。</p>
        <p>表示テーマはブラウザのlocalStorageに保存することがあります。サーバには送りません。</p>

        <h2 className="text-lg font-semibold pt-2">書き出しと退会</h2>
        <p>会員は、ほしいもの、購入済み、または全部をCSVで書き出せます。設定には、拡張機能用のトークンを表示します。</p>
        <p>設定の退会は、会員のアカウント、商品、価格履歴、カテゴリ、比較グループ、通知設定、アップロード画像、写真検索の記録と回数を消します。元に戻す操作はありません。</p>

        <h2 className="text-lg font-semibold pt-2">解析</h2>
        <p>画面に、広告配信やアクセス解析の外部タグは入れていません。</p>
        <p>下書きの日付は2026-10-23です。</p>
        <LegalLinks />
      </article>
    </main>
  );
}
