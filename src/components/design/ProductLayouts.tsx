import Image from 'next/image';
import { ImageOff } from 'lucide-react';
import type { ReviewProduct } from '@/lib/design-home';

export function ProductPicture({ product }: { product: ReviewProduct }) {
  return product.image
    ? <Image src={product.image} width={620} height={480} alt="" unoptimized />
    : <span className="review-empty-image"><ImageOff aria-hidden size={24} /><span>写真なし</span></span>;
}
