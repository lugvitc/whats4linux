const SimpleIconTitle = ({ title, icon, link }: { title: string; icon: string; link: string }) => {
  return (
    <div
      className="flex flex-row items-center gap-4 w-full hover:bg-hover-icons p-4 rounded-xl"
      onClick={() => window.open(link, "_blank")}
    >
      <div>{icon}</div>
      <div className="text-xl font-semibold">{title}</div>
    </div>
  )
}

export default SimpleIconTitle
