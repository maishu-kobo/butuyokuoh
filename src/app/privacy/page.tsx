import type { Metadata } from 'next';
import Link from 'next/link';
import LegalLinks from '@/components/LegalLinks';
import {
  CLOUDFLARE_PRIVACY_POLICY_URL,
  CONTACT_EMAIL,
  FOREIGN_PRIVACY_SYSTEMS_URL,
  GOOGLE_PRIVACY_POLICY_URL,
  LEGAL_EFFECTIVE_DATE,
  OPERATOR_NAME,
} from '@/lib/legal';

export const metadata: Metadata = {
  title: 'プライバシーポリシー - 物欲王',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <article className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        <p className="text-sm">
          <Link href="/" className="underline underline-offset-2">アプリへ戻る</Link>
        </p>
        <h1 className="text-2xl font-bold">プライバシーポリシー</h1>
        <p>
          物欲王（以下「本サービス」といいます）の運営者（以下「運営者」といいます）は、本サービスにおける利用者情報の取扱いについて、以下のとおりプライバシーポリシー（以下「本ポリシー」といいます）を定めます。
        </p>

        <h2 className="text-lg font-semibold pt-2">1. 取得する情報</h2>
        <p>運営者は、本サービスの提供にあたり、次の情報を取得することがあります。</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            会員情報。メールアドレスとパスワード（保存するのは照合用の値で、入力したパスワードそのものではありません）、任意の表示名。
          </li>
          <li>
            Googleアカウントでログインするとき。メールアドレス、名前、Google上の識別子。同じメールアドレスの会員に結びつけると、それまでのパスワードログインは使えなくなります。
          </li>
          <li>
            ほしいものリストの内容。商品名、商品ページのURL、店舗の画像、価格、メモ、優先度、個数、購入予定日、購入済みかどうか、カテゴリ、比較のためのグループ分けなど。
          </li>
          <li>
            会員がアップロードした画像。位置情報などの付随データは除いてから保存します。
          </li>
          <li>
            写真から商品を探すときの結果。推定した商品名や関連する識別情報、利用回数の記録など。写真そのものは保管しません。検索で見つけた候補は短時間で消します。
          </li>
          <li>
            Chrome拡張機能から送られる情報。認証用のトークンと、追加または取り込む商品の名称、URL、価格、画像、優先度、カテゴリなど。
          </li>
          <li>
            ゲストとして試すときの情報。メールアドレスは受け取りません。仮の識別子と、体験用のサンプルデータ、体験中に登録した内容です。
          </li>
          <li>
            通知の設定。会員が指定したSlackまたはDiscordへの通知先と、通知のオン・オフ。
          </li>
          <li>クッキーその他の識別情報（後述）。</li>
          <li>
            運用のための記録。障害対応や不正利用の防止のため、処理の成否や一部のURL・商品名などが残ることがあります。パスワード、認証トークン、写真そのものを意図して記録しません。
          </li>
        </ul>

        <h2 className="text-lg font-semibold pt-2">2. 利用目的</h2>
        <p>取得した情報は、次の目的で利用します。</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>本サービスの提供、維持、本人確認、ログイン状態の管理</li>
          <li>ほしいものリストの表示、価格の取得と履歴の保存、通知の送信</li>
          <li>写真からの商品候補の提示と、その利用量の管理</li>
          <li>Chrome拡張機能からの商品追加・取り込み</li>
          <li>お問い合わせへの対応、不正利用の防止、セキュリティの確保</li>
          <li>本ポリシーや利用規約の変更など、重要な周知</li>
          <li>上記に付随する本サービスの改善（個人を特定しない集計を含みます）</li>
        </ul>

        <h2 className="text-lg font-semibold pt-2">3. 保存期間と削除</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>会員のデータは、退会するまで、または本サービスの提供に必要な期間、保存します。</li>
          <li>
            退会すると、アカウントと登録したデータは原則として消えます。元に戻すことはできません。写真判定の利用量など、サービス全体の上限管理に必要な記録は、会員との紐付けを外した形で残すことがあります。
          </li>
          <li>
            アップロードした画像も原則として消します。ただし、他の会員が同じファイルを参照しているときは残すことがあります。
          </li>
          <li>
            ゲストのデータは、体験の期限（標準では約24時間）が切れるか、体験を終えたときに消えます。会員アカウントには引き継がれません。
          </li>
          <li>写真検索の候補は、短時間（およそ30分）で消します。</li>
        </ul>

        <h2 className="text-lg font-semibold pt-2">4. 外部サービスへの送信</h2>
        <p>
          運営者は、法令に基づく場合を除き、本人の同意なく個人情報を第三者に販売・提供しません。本サービスの機能のために、次のとおり外部へ情報を送ることがあります。
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            Googleでログインするとき。ログインに必要な情報を、Google合同会社およびその関連会社の認証サービスへ送ります。
          </li>
          <li>
            写真から商品を推定するとき。位置情報を除いて縮小した画像を、Cloudflare, Inc.（米国）のAIサービスへ送ります。この機能を使わないときは送りません。
          </li>
          <li>
            商品名から候補を探すとき。Yahoo!ショッピングや楽天市場など、連携している店舗の検索サービスへ検索語を送ることがあります。
          </li>
          <li>
            商品URLの登録や価格の確認をするとき。その商品ページを取得します。価格の自動確認の対象は、未購入の商品などに限られ、一部の写真から登録した商品は対象外とすることがあります。楽天の商品は、楽天のAPIで価格を取り直すことがあります。
          </li>
          <li>
            価格の通知。会員が指定したSlackまたはDiscordの通知先へ、商品名、URL、画像、価格などを送ることがあります。
          </li>
          <li>
            データの保管と処理。本サービスのデータは、ホスティング事業者のサーバに保存・処理されます。
          </li>
        </ul>

        <h2 className="text-lg font-semibold pt-2">5. 外国にある第三者への提供</h2>
        <p>
          本サービスでは、アメリカ合衆国にある事業者へ個人データを提供する場合があります（例：Googleによるログイン、Cloudflare, Inc. による写真からの商品推定）。
        </p>
        <p>
          アメリカ合衆国における個人情報の保護に関する制度については、個人情報保護委員会が公表している「外国における個人情報の保護に関する制度等の調査」をご確認ください（
          <a href={FOREIGN_PRIVACY_SYSTEMS_URL} className="underline underline-offset-2" target="_blank" rel="noopener noreferrer">
            {FOREIGN_PRIVACY_SYSTEMS_URL}
          </a>
          ）。
        </p>
        <p>
          提供先が講じる措置は、各社のプライバシーポリシーおよび、運営者が利用する際のデータ処理に関する契約等によります。例として、
          <a href={GOOGLE_PRIVACY_POLICY_URL} className="underline underline-offset-2" target="_blank" rel="noopener noreferrer">Googleのプライバシーポリシー</a>
          、
          <a href={CLOUDFLARE_PRIVACY_POLICY_URL} className="underline underline-offset-2" target="_blank" rel="noopener noreferrer">Cloudflareのプライバシーポリシー</a>
          をご参照ください。
        </p>

        <h2 className="text-lg font-semibold pt-2">6. クッキーと外部送信</h2>
        <p>
          本サービスは、ログイン状態の維持などのためにクッキーを使います。広告配信やアクセス解析のための外部タグは入れていません。
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <span className="font-medium">butuyokuoh_token</span>
            … 目的：会員のログイン維持。送信先：本サービスのサーバ。有効期間：およそ7日。
          </li>
          <li>
            <span className="font-medium">butuyokuoh_guest</span>
            … 目的：ゲスト体験の維持。送信先：本サービスのサーバ。有効期間：ゲスト体験の期限まで。
          </li>
          <li>
            Googleログイン用のクッキー
            … 目的：Googleアカウントでのログイン維持。送信先：本サービスのサーバおよびGoogleの認証に必要な範囲。有効期間：ログインセッションのあいだ。
          </li>
        </ul>
        <p>
          表示テーマは、お使いのブラウザ内にだけ保存することがあり、サーバには送りません。機能の利用時には、上記の外部サービスへ、それぞれの目的に必要な情報が送られます。
        </p>

        <h2 className="text-lg font-semibold pt-2">7. 安全管理措置</h2>
        <p>
          運営者は、漏えい、滅失またはき損の防止その他の安全管理のため、パスワードを照合用の値として保存すること、通信の暗号化、アップロード画像からの位置情報の除去、認証情報や写真を意図して記録しないことなどの措置を講じます。
        </p>

        <h2 className="text-lg font-semibold pt-2">8. 保有個人データに関する事項・開示等の請求</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>個人情報取扱事業者の氏名：{OPERATOR_NAME}</li>
          <li>住所：ご請求に応じて遅滞なくお知らせします。</li>
          <li>
            保有個人データの利用目的：本ポリシー「利用目的」に記載のとおりです。
          </li>
          <li>
            開示等の請求、苦情の申出先：{CONTACT_EMAIL}
            （利用目的の通知、開示、訂正、追加、削除、利用停止等。本人確認のため、追加の情報をお願いすることがあります。）
          </li>
        </ul>

        <h2 className="text-lg font-semibold pt-2">9. 本ポリシーの変更</h2>
        <p>
          運営者は、必要に応じて本ポリシーを変更できます。変更後の本ポリシーは、本ページに掲載したときから効力を生じます。重要な変更があるときは、本サービス上での表示その他適切な方法で周知します。
        </p>

        <p>制定日・施行日：{LEGAL_EFFECTIVE_DATE}</p>
        <LegalLinks />
      </article>
    </main>
  );
}
