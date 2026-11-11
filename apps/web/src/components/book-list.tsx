import Link from 'next/link';
import type { BookSummaryDto } from '@mirabelu/contracts';
import { fmtDuration } from '@/lib/api';
import { Cover } from './cover';

export function BookTiles({ books }: { books: BookSummaryDto[] }) {
  return (
    <div className="tiles">
      {books.map((b) => (
        <Link key={b.id} href={`/livre/${b.slug}`} className="tile">
          <Cover title={b.title} url={b.coverUrl} />
          <div>
            <h3>{b.title}</h3>
            <p className="muted small">{b.author.name}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function BookRows({ books, progress }: { books: { book: BookSummaryDto; positionSec?: number; completed?: boolean }[]; progress?: boolean }) {
  return (
    <ul className="rows">
      {books.map(({ book, positionSec = 0, completed }) => (
        <li key={book.id}>
          <Link href={`/livre/${book.slug}`} className="row">
            <Cover title={book.title} url={book.coverUrl} small />
            <div>
              <h3>{book.title}</h3>
              <p className="meta">{book.author.name} · {fmtDuration(book.durationSec)}</p>
              {progress && book.durationSec > 0 && (
                <div className="progress-line" role="img" aria-label={completed ? 'Terminé' : `Écouté à ${Math.round((positionSec / book.durationSec) * 100)} %`}>
                  <i style={{ width: `${completed ? 100 : Math.min(100, (positionSec / book.durationSec) * 100)}%` }} />
                </div>
              )}
            </div>
            <span className="meta">{book.category.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
