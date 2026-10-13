import type { LiveObstacle } from './live';

const shape = (x: number, y: number, width: number, height: number, kind: LiveObstacle['kind'], label?: string): LiveObstacle => ({ x, y, width, height, kind, ...(label ? { label } : {}) });
const building = (x: number, y: number, width: number, height: number, label: string) => shape(x, y, width, height, 'building', label);
const wall = (x: number, y: number, width: number, height: number, label?: string) => shape(x, y, width, height, 'wall', label);
const cargo = (x: number, y: number, width: number, height: number, label?: string) => shape(x, y, width, height, 'container', label);
const cover = (x: number, y: number, width: number, height: number, label?: string) => shape(x, y, width, height, 'barricade', label);

/** Two opposing three-cell doorways remain visible and genuinely traversable. */
function openHall(x: number, y: number, width: number, height: number, label: string): LiveObstacle[] {
  const wing = Math.floor((width - 3) / 2), other = width - wing - 3;
  return [wall(x, y, wing, 1, label), wall(x + wing + 3, y, other, 1),
    wall(x, y + height - 1, wing, 1), wall(x + wing + 3, y + height - 1, other, 1),
    wall(x, y + 1, 1, height - 2), wall(x + width - 1, y + 1, 1, height - 2)];
}

/** Distinct local 22×22 silhouettes; the generator scales, rotates and connects them. */
export function prefabObstacles(id: string): LiveObstacle[] {
  switch (id) {
    case 'warehouse': return [
      building(3, 3, 8, 4, 'Склад'), building(3, 7, 4, 6, 'Крыло склада'),
      cargo(13, 4, 6, 2, 'Погрузка'), cargo(13, 10, 3, 2), cover(8, 16, 7, 1, 'Поддоны'), wall(18, 14, 1, 5),
    ];
    case 'office': return [
      building(5, 4, 7, 5, 'Таможенный архив'), building(14, 13, 4, 4, 'КПП'),
      wall(15, 3, 1, 7), cover(4, 14, 4, 1, 'Документы'), cargo(10, 17, 2, 2),
    ];
    case 'containers': return [
      cargo(3, 3, 7, 2, 'Северный ряд'), cargo(12, 3, 6, 2), cargo(4, 9, 2, 8),
      cargo(10, 10, 8, 2, 'Грузовой двор'), cargo(15, 16, 5, 2), cover(8, 17, 3, 1), cover(18, 7, 2, 1),
    ];
    case 'workshop': return [
      ...openHall(2, 3, 8, 14, 'Ангар №1'), ...openHall(12, 5, 8, 11, 'Ангар №2'),
      cover(5, 8, 2, 2, 'Станки'), cover(15, 9, 2, 2), cargo(10, 19, 4, 1, 'Запчасти'),
    ];
    case 'sawmill': return [
      ...openHall(3, 3, 14, 10, 'Лесопильный цех'), building(3, 16, 8, 4, 'Сушильня'),
      cover(6, 7, 2, 2, 'Станки'), cover(12, 8, 2, 2), cover(17, 16, 1, 4, 'Брёвна'), cargo(18, 5, 2, 3),
    ];
    case 'camp': return [
      building(4, 4, 4, 3, 'Барак'), building(14, 12, 4, 4, 'Пост охраны'),
      cover(11, 5, 4, 1, 'Кострище'), cover(5, 14, 2, 2, 'Припасы'), wall(17, 3, 1, 5),
      shape(10, 18, 1, 1, 'tree'), shape(3, 10, 1, 1, 'tree'),
    ];
    case 'cabin': return [
      building(5, 6, 5, 4, 'Дом лесника'), building(14, 4, 3, 3, 'Сарай'),
      cover(5, 15, 5, 1, 'Дрова'), wall(15, 11, 1, 6), cargo(17, 18, 2, 1), shape(3, 18, 1, 1, 'tree'),
    ];
    case 'logging': return [
      cover(3, 4, 8, 1, 'Штабель брёвен'), cover(12, 8, 7, 1), cover(4, 12, 1, 6), cover(8, 16, 8, 1),
      building(14, 2, 4, 3, 'Инструменты'), cargo(17, 13, 2, 3), shape(2, 8, 1, 1, 'tree'),
    ];
    case 'wagons': return [
      cargo(3, 3, 2, 12, 'Состав №1'), cargo(10, 7, 2, 12, 'Состав №2'), cargo(17, 2, 2, 11, 'Состав №3'),
      cover(3, 18, 4, 1, 'Платформа'), cover(15, 17, 5, 1), building(7, 2, 4, 3, 'Диспетчерская'),
    ];
    case 'depot': return [
      ...openHall(2, 3, 7, 15, 'Ремонтный зал'), ...openHall(13, 4, 8, 12, 'Тепловозный зал'),
      cargo(10, 3, 2, 8, 'Локомотив'), cover(4, 10, 2, 2), cover(16, 9, 2, 2), cover(14, 19, 5, 1),
    ];
    case 'clinic': return [
      building(4, 3, 8, 4, 'Медпункт'), building(4, 7, 4, 5, 'Лечебное крыло'),
      cover(12, 10, 3, 1, 'Медицинские ящики'), wall(17, 5, 1, 5), cargo(15, 16, 3, 2),
    ];
    case 'archive': return [
      building(4, 4, 8, 5, 'Администрация'), building(14, 10, 4, 5, 'Архив'),
      wall(4, 14, 5, 1), cover(12, 17, 4, 1, 'Картотека'), cargo(17, 3, 2, 2),
    ];
    case 'apartments': return [
      building(3, 3, 5, 5, 'Дом №1'), building(13, 3, 6, 4, 'Дом №2'),
      building(4, 13, 4, 6, 'Дом №3'), building(13, 13, 6, 6, 'Дом №4'), cover(10, 10, 2, 1, 'Двор'),
    ];
    case 'market': return [
      building(3, 3, 6, 3, 'Лавки'), building(14, 15, 5, 4, 'Склад рынка'),
      cargo(13, 4, 5, 2, 'Ряды'), cargo(4, 11, 2, 6), cover(9, 10, 5, 1, 'Прилавки'), cover(10, 15, 1, 4),
    ];
    case 'fuel': return [
      building(3, 3, 7, 4, 'Заправочная станция'), cargo(15, 3, 3, 5, 'Топливные резервуары'),
      cover(6, 12, 2, 1, 'Колонка №1'), cover(11, 12, 2, 1, 'Колонка №2'), cover(16, 12, 2, 1, 'Колонка №3'), wall(4, 18, 5, 1),
    ];
    case 'checkpoint': return [
      building(3, 3, 4, 4, 'Караульный пост'), building(15, 14, 4, 4, 'Досмотр'),
      wall(3, 11, 4, 1), wall(14, 10, 6, 1), cover(10, 6, 2, 1, 'Шлагбаум'), cargo(4, 16, 5, 2, 'Задержанный груз'),
    ];
    case 'hunting': return [
      building(5, 4, 5, 4, 'Охотничий дом'), building(15, 15, 3, 3, 'Сарай'),
      cover(3, 13, 5, 1, 'Дрова'), cover(13, 10, 3, 1, 'Охотничьи припасы'), shape(16, 3, 1, 1, 'tree'), shape(3, 18, 1, 1, 'tree'),
    ];
    case 'creekcamp': return [
      building(3, 5, 4, 3, 'Дом у ручья'), building(14, 3, 4, 3, 'Наблюдательный пост'),
      cover(11, 11, 3, 1, 'Кострище'), cargo(5, 15, 3, 2, 'Лодочные припасы'), wall(17, 12, 1, 6), shape(4, 2, 1, 1, 'tree'),
    ];
    case 'substation': return [
      building(3, 3, 6, 3, 'Щитовая'), cargo(4, 10, 3, 3, 'Трансформатор №1'), cargo(11, 7, 3, 3, 'Трансформатор №2'), cargo(16, 13, 3, 3, 'Трансформатор №3'),
      wall(2, 9, 1, 8), wall(10, 18, 6, 1), cover(16, 3, 3, 1, 'Кабельные катушки'),
    ];
    case 'coal': return [
      cargo(3, 3, 6, 4, 'Угольный бункер'), cargo(13, 10, 5, 5, 'Угольный склад'),
      building(13, 3, 5, 3, 'Весовая'), cover(3, 13, 6, 1, 'Конвейер'), cover(7, 18, 5, 1, 'Погрузка'),
    ];
    case 'school': return [
      building(3, 3, 8, 4, 'Школьный корпус'), building(3, 7, 4, 6, 'Учебное крыло'),
      building(14, 15, 5, 4, 'Спортивный зал'), cover(12, 10, 5, 1, 'Школьный двор'), wall(4, 17, 5, 1),
    ];
    case 'greenhouse': return [
      ...openHall(2, 3, 5, 13, 'Теплица №1'), ...openHall(9, 5, 5, 13, 'Теплица №2'), ...openHall(16, 3, 5, 13, 'Теплица №3'),
      cover(4, 19, 4, 1, 'Инструменты'), cover(15, 19, 4, 1, 'Рассадные ящики'),
    ];
    default: return [building(5, 5, 6, 4, 'Корпус'), cover(14, 13, 4, 1)];
  }
}
