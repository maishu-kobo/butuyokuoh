import type { Metadata } from 'next';
import Link from 'next/link';
import LegalLinks from '@/components/LegalLinks';
import {
  CONTACT_EMAIL,
  JURISDICTION_COURT,
  LEGAL_EFFECTIVE_DATE,
  OPERATOR_NAME,
} from '@/lib/legal';

export const metadata: Metadata = {
  title: '利用規約 - 物欲王',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <article className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        <p className="text-sm">
          <Link href="/" className="underline underline-offset-2">アプリへ戻る</Link>
        </p>
        <h1 className="text-2xl font-bold">利用規約</h1>
        <p>
          この利用規約（以下「本規約」といいます）は、物欲王（以下「本サービス」といいます）の利用条件を定めるものです。本サービスを利用する方（以下「利用者」といいます）は、本規約に同意のうえでご利用ください。本サービスを利用した時点で、本規約に同意したものとみなします。
        </p>

        <h2 className="text-lg font-semibold pt-2">1. サービス内容</h2>
        <p>
          本サービスは、ほしいものの一覧、価格、メモ、写真からの候補などを、利用者自身の画面に残すためのウェブアプリです。本サービスの中に、代金を払う機能はありません。
          {OPERATOR_NAME.trim() ? `運営者は${OPERATOR_NAME}です。` : ''}
        </p>

        <h2 className="text-lg font-semibold pt-2">2. アカウント</h2>
        <p>会員はメールアドレスとパスワードで登録できます。名前は任意です。Googleアカウントでのログインも利用できる場合があります。</p>
        <p>
          ゲストとして試すこともできる場合があります。期限が切れるか体験を終えるとデータは消え、会員アカウントには引き継がれません。
        </p>
        <p>会員がログアウトすると、それまでのログインは使えなくなります。</p>
        <p>設定から退会すると、アカウントと登録したデータは消えます。元に戻すことはできません。詳細はプライバシーポリシーをご覧ください。</p>
        <p>
          利用者は、自己の責任で認証情報（パスワードおよび拡張機能用のトークンを含みます）を管理してください。第三者に貸与・共有してはなりません。
        </p>

        <h2 className="text-lg font-semibold pt-2">3. 未成年の利用</h2>
        <p>
          未成年の方が本サービスを利用する場合は、親権者その他の法定代理人の同意を得たうえでご利用ください。
        </p>

        <h2 className="text-lg font-semibold pt-2">4. 禁止事項</h2>
        <p>利用者は、本サービスの利用にあたり、次の行為をしてはなりません。</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>法令または公序良俗に反する行為</li>
          <li>本サービスまたは第三者の権利・利益を侵害する行為</li>
          <li>不正アクセス、過度な負荷、スクレイピングの悪用、システムの解析や妨害</li>
          <li>他の利用者のアカウントや認証情報を無断で利用する行為</li>
          <li>本サービスの運営を妨げる行為、またはそのおそれのある行為</li>
        </ul>

        <h2 className="text-lg font-semibold pt-2">5. 外へ送るもの・外部サイト</h2>
        <p>
          商品URLを登録したり価格を確認したりすると、その商品ページを取得します。写真から探すと、写真は本サービスへ届きます。写真から商品を推定するときは、位置情報を除いて縮小した画像を Cloudflare, Inc.（米国）のAIサービスへ送ります。この機能を使わないときは送りません。写真そのものは保管しません。商品名の検索では、Yahoo!ショッピングや楽天市場など連携先へ検索語を送ることがあります。通知先を保存しているときは、価格の通知をその宛先へ送ることがあります。取扱いの詳細はプライバシーポリシーに従います。
        </p>

        <h2 className="text-lg font-semibold pt-2">6. 価格・在庫・アフィリエイト</h2>
        <p>
          本サービスに表示する価格、在庫、商品情報は、各ストアから取得した時点の参考情報です。実際の購入条件は、各ストアの表示が正しいものとします。運営者は、表示の正確性、最新性、取引の成立を保証しません。
        </p>
        <p>
          Amazonの検索リンクや楽天の商品URLに、アフィリエイト用の識別子が付くことがあります。Amazonのアソシエイトとして適格販売により収入を得る場合は、該当リンクの近くにその旨を表示します。楽天の検索結果があるときは、画面に「Supported by Rakuten Developers」などのクレジットを出すことがあります。
        </p>

        <h2 className="text-lg font-semibold pt-2">7. データの書き出し</h2>
        <p>会員は自分のデータをCSVで書き出せます。設定に出る拡張機能用のトークンは、その会員の画面に表示します。</p>

        <h2 className="text-lg font-semibold pt-2">8. 免責および責任の制限</h2>
        <p>
          本サービスは現状有姿で提供されます。運営者は、本サービスの正確性、完全性、有用性、特定目的適合性、稼働の中断の不存在について、法令で許される範囲で保証しません。
        </p>
        <p>
          運営者は、本サービスの利用または利用不能により利用者に生じた損害について、運営者の故意または重過失による場合を除き、法令で許される範囲で責任を負いません。運営者が責任を負う場合であっても、通常生じうる損害の範囲に限り、かつ逸失利益その他の間接損害を法令で許される範囲で負わないものとします。
        </p>
        <p>
          消費者契約法その他の強行法規により本規約の条項が制限される場合、当該法規が定める範囲で本規約は適用され、無効となる部分があっても、残りの部分は効力を有します。
        </p>

        <h2 className="text-lg font-semibold pt-2">9. 本規約の変更</h2>
        <p>
          運営者は、民法第548条の4に基づき、次の場合に本規約を変更できます。（1）変更が利用者の一般の利益に適合するとき。（2）変更が本規約の目的に反せず、かつ変更の必要性、変更後の内容の相当性その他の事情に照らして合理的なものであるとき。変更後の本規約は、本ページへの掲載その他の適切な方法で周知し、掲載において定める効力発生日から適用します。
        </p>

        <h2 className="text-lg font-semibold pt-2">10. 準拠法・管轄</h2>
        <p>本規約は日本法に準拠します。</p>
        <p>
          本サービスに関して紛争が生じた場合、{JURISDICTION_COURT}を第一審の専属的合意管轄裁判所とします。
        </p>

        <h2 className="text-lg font-semibold pt-2">11. お問い合わせ</h2>
        <p>
          本規約に関するお問い合わせは、{CONTACT_EMAIL} までご連絡ください。
        </p>

        <p>制定日・施行日：{LEGAL_EFFECTIVE_DATE}</p>
        <LegalLinks />
      </article>
    </main>
  );
}
