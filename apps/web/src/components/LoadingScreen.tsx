'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { onPreload, preloadAll, preloadState } from '@/lib/preload';
import { rollKeyLabel, useSettings } from '@/lib/settings';
import { LoadingBackdrop } from './LoadingBackdrop';
import { Icon } from './Icon';

/** Short how-to-play hints shown while the game downloads. */
export const TIPS = [
  'WASD để di chuyển, giữ Shift để chạy, V để lướt, X để ngồi, giữ Q/E để nghiêng bắn, C để nằm hoặc đứng dậy.',
  'Nhấn E để nhặt đồ, nói chuyện với nhân vật, mở kho đạn hoặc kho cá nhân.',
  'Nhấn E khi đứng gần Bác Ba Nông Dân để nhận nhiệm vụ và mua khoai tây.',
  'Đứng lên một ô ruộng trống để mở bảng gieo hạt bên phải màn hình.',
  'Khoai chín thì nhấn E và đứng yên 3 giây để thu hoạch được 4 củ.',
  'Nấu thịt sống ở lửa trại cạnh bếp — đồ chín hồi nhiều thể lực hơn đồ sống.',
  'Chuột phải vào thức ăn trong kho đồ để ăn. Đồ sống nhanh đói hơn.',
  'Thanh thể lực màu xanh dưới thanh máu: chạy, lộn và tấn công đều tốn thể lực.',
  'Phần sọc đỏ trên thanh thể lực là phần bị mất do đói — hãy ăn để hồi lại.',
  'Trung sĩ Bếp Tư bán thịt chín và khoai nướng nếu bạn không kịp nấu.',
  'Đại tá Lâm canh cổng bằng súng phóng lựu và giao nhiệm vụ chiến đấu.',
  'Vật phẩm nhiệm vụ có dấu "!" vàng — giữ trong ba lô để giao cho nhân vật.',
  'Mũi tên nhiệm vụ chỉ vị trí món đồ cần tìm; hướng dẫn tân thủ có mũi tên lớn quanh nhân vật.',
  'Kho cá nhân ở khu nhà kho cạnh thương nhân vũ khí: 3 trang chứa đồ riêng.',
  'Ba lô đầy khi nhận thưởng? Phần thưởng sẽ được gửi vào kho cá nhân.',
  'Đặt đèn pin vào ô "Tay phụ" — đèn tự bật khi bạn ở nơi tối.',
  'Di chuột vào người thây ma hoặc con vật để tự ngắm đúng mục tiêu.',
  'Leo thang: đi thẳng vào thang để leo lên, lùi lại để leo xuống, Space để nhảy ra.',
  'Đừng bắn nhân vật trong căn cứ — họ sẽ rút súng săn ra hỏi "Muốn đấu tay đôi?".',
  'Nhấn H để dùng hộp cứu thương (mất 5 giây, di chuyển sẽ bị hủy).',
  'Nhấn R để thay đạn, cuộn chuột hoặc phím 1–4 để đổi vũ khí.',
  'Nhấn F3 để xem FPS, ping, TPS và các thông số kỹ thuật.',
  'Nhấn Esc để tạm dừng, nhấn Esc lần nữa để tiếp tục.',
  'Lợn rừng và cừu hoang xuất hiện ngẫu nhiên ngoài bản đồ — săn để lấy thịt.',
];

/** Full-screen loader on the main menu: downloads models and sounds, shows progress and tips. */
export function LoadingScreen({ onDone }: { onDone: () => void }) {
  const { rollKey, proneKey } = useSettings();
  const s = useSyncExternalStore(onPreload, preloadState, preloadState);
  // Same first tip on server and client (hydration); shuffled once mounted.
  const [tip, setTip] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    void preloadAll().then(() => {
      setLeaving(true);
      window.setTimeout(onDone, 450);
    });
    setTip(Math.floor(Math.random() * TIPS.length));
    const t = window.setInterval(() => setTip((i) => (i + 1) % TIPS.length), 4500);
    return () => window.clearInterval(t);
  }, [onDone]);

  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  return (
    <LoadingBackdrop leaving={leaving}>
        <div className="loader-row">
          <i className="spinner" />
          <span aria-hidden><Icon name="lucide:download" /></span>
          <b>{pct}%</b>
        </div>
        <div className="loader-bar" role="progressbar" aria-label="Tải tài nguyên trò chơi" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div style={{ width: `${pct}%` }} /></div>
        <div className="loader-file">{s.file ? `${s.done}/${s.total} · ${s.file}` : s.total ? `${s.done}/${s.total}` : ''}</div>
        <div className="loader-tip">
          <span aria-label="Mẹo"><Icon name="lucide:lightbulb" /></span>
          <p key={tip}>{TIPS[tip]?.replace('V để lướt', `${rollKeyLabel(rollKey)} để lướt`).replace('C để nằm', `${rollKeyLabel(proneKey)} để nằm`)}</p>
        </div>
    </LoadingBackdrop>
  );
}
